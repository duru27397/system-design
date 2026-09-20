# How Shopify Moved Inventory Reservations from Redis to MySQL

> Source: [https://www.hellointerview.com/learn/system-design/in-the-wild/shopify-inventory-reservations](https://www.hellointerview.com/learn/system-design/in-the-wild/shopify-inventory-reservations)

---

# How Shopify Moved Inventory Reservations from Redis to MySQL

By[Evan King](https://www.linkedin.com/in/evan-king-40072280/)·Published Jul 14, 2026

###### Read the Source Blog

Originally published by Shopify Engineering on May 12, 2026

[View](https://shopify.engineering/scaling-inventory-reservations)

## The TLDR

Shopify processes more than 14% of U.S. e-commerce. In order to prevent incorrectly selling the last item in stock to two buyers at the same time, every checkout is protected by a reservation system. When a buyer starts paying, Shopify reserves their items for a few minutes. If the payment succeeds, it permanently deducts them from the merchant’s record of how much inventory remains.

For years, those two steps occurred in different databases. Redis tracked how many units shoppers had temporarily reserved, while MySQL tracked how many units the merchant actually had. Since no single transaction could update both together, a crash between the two writes could leave them in disagreement, either hiding inventory that was still available or allowing Shopify to sell inventory that was already gone.

Shopify moved reservations from Redis into MySQL, so now both operations can happen in a single transaction. Instead of keeping a single row per inventory with a count of how many units are available, it uses a bounded pool of rows, with each row representing one reservable unit. They could then rely on MySQL 8’s SKIP LOCKED to let concurrent buyers claim different rows without waiting on each other, while a replenishment process keeps the pool from growing with the merchant’s full inventory. The rebuilt system survived Black Friday 2025, even as merchant sales peaked at a record $5.1 million a minute.

We chose this post to dig into because it's the seat-per-row move from [ticket booking](https://www.hellointerview.com/learn/system-design/problem-breakdowns/ticketmaster#1-how-do-we-improve-the-booking-experience-by-reserving-tickets), where you store one row per seat so buyers contend on different rows, proven in production at enormous scale. It also shows that a relational database with the right table design can handle workloads many engineers assume need specialized infrastructure. The [original](https://shopify.engineering/scaling-inventory-reservations) is worth your time too.

## The problem

### What oversell protection does

Picture a flash sale with one hoodie left and two buyers hitting the pay button at the same time. Shopify needs to make sure only one of them can buy it.

That is the job of oversell protection. When a buyer starts paying, the system reserves their items for a few minutes so nobody else can take them while the payment processes. If the payment succeeds, Shopify claims those items, permanently deducting them from the merchant’s inventory. If the payment fails or times out, it releases the reservation and makes them available again.

Getting either side wrong costs the merchant money. If two buyers purchase the same last hoodie, one order has to be canceled. If Shopify hides a hoodie that is still sitting in the warehouse, the merchant loses a sale. This system sits in the path of every inventory-backed checkout, so even rare mistakes become common at Shopify’s scale.

### Why Redis had to go

For years, Shopify stored temporary reservations in Redis, using one counter per item. Reserving or releasing units updated that counter, and because [Redis executes commands one at a time](https://www.hellointerview.com/learn/system-design/deep-dives/redis), two buyers could not both reserve the same last unit. As a concurrency mechanism, Redis worked.

The problem was that the merchant’s permanent inventory record lived in MySQL. Once a payment succeeded, Shopify had to make two changes: deduct the purchased units from MySQL and clear the temporary reservation in Redis. Those writes happened in different databases, so they could not commit together.

Suppose Shopify updates MySQL first and then crashes before clearing the reservation in Redis. The purchase is complete, but Redis still treats those units as reserved, so Shopify hides inventory that is actually available. Reverse the order and the opposite can happen. Shopify clears the reservation, crashes before updating MySQL, and makes units available again even though they were already sold.

Changing the order only changes which failure is possible. It does not remove the window between the two writes.

!

Redis and MySQL

The standard set of fixes like two-phase commit or an outbox did not close that window either. Two-phase commit would require both databases to participate in the same coordination protocol, which Redis could not do because it doesn't speak the same language. And while an outbox or reconciliation job could eventually detect and repair a mismatch, inventory would still be wrong until that happened. In the middle of a flash sale, wrong for even a short time can mean selling the same unit twice.

## The solution

### One row per reservable unit

Moving reservations into MySQL solved the transaction problem, but Shopify had tried (and failed) with the obvious MySQL design before: one row per item with a quantity counter.

```
-- The failed first attempt, simplified
UPDATE reservations
SET available = available - 1
WHERE inventory_item_id = 42 AND available >= 1;
```

Every checkout for a popular item had to update the same row. InnoDB, MySQL’s default storage engine, grants that row lock to one transaction at a time, so every other buyer has to wait. This meant that during a flash sale, thousands of checkouts for the same item collapsed onto a single lock, forcing the database to process them one after another which slowed things to a crawl.

The new design spreads that contention across a pool of rows. Each row in reservation\_units represents one unit that can currently be reserved. To reserve three hoodies, Shopify selects and locks three available rows, removes them from the pool, and creates one active hold in reserved\_quantities, all inside the same transaction.

The magic comes from MySQL 8's SELECT ... FOR UPDATE SKIP LOCKED, which is SELECT ... FOR UPDATE combined with SKIP LOCKED. An ordinary FOR UPDATE query waits when it reaches a row another transaction has locked. SKIP LOCKED tells MySQL to pass over that row and keep looking for an available one. So with it, two buyers reserving the same item can lock different rows and commit in parallel instead of lining up behind one shared counter.

This is the one-row-per-seat trick from our [Ticketmaster breakdown](https://www.hellointerview.com/learn/system-design/problem-breakdowns/ticketmaster#1-how-do-we-improve-the-booking-experience-by-reserving-tickets). Instead of making every buyer contend on one quantity row, you give them separate rows to claim. The broader pattern is covered in [dealing with contention](https://www.hellointerview.com/learn/system-design/patterns/dealing-with-contention).

!

SKIP LOCKED

```
BEGIN;

SELECT id FROM reservation_units
WHERE shop_id = 1
  AND inventory_item_id = 42
  AND inventory_group_id = 7
LIMIT 3
FOR UPDATE SKIP LOCKED;

-- Remove the selected units from the available pool,
-- then create one active hold in reserved_quantities.

COMMIT;
```

### A bounded pool

With this design, the natural challenge that emerges is that at scale, a single item could produce hundreds of thousands of mostly idle rows, and the scans would get slower as the table grew. Considering Shopify deals with millions of items, the scale makes a row per item a non-starter.

So instead, Shopify caps the number of reservation rows for any given item at 1,000 and relies on a replenishment process to keep the pool filled when it runs low.

A rush can still drain it before the background process catches up. When that happens, the reservation request refills the pool inline and then tries again. A lock ensures that only one transaction performs the refill while other requests for the same item wait, preventing them from adding the same capacity more than once. Whenever this happens, the request that triggers the refill takes longer, but Shopify does not reject a buyer when the ledger says inventory still exists just because the reservation pool has fallen behind.

The post doesn't say how much latency this fallback adds or how Shopify handles orders larger than the 1,000-row pool.

### Making the locks behave

The basic design removed the single hot row. Making it safe under production traffic required three more changes to how InnoDB acquired locks.

The first prototype used an ordinary auto-increment primary key, while reservation queries searched through a secondary index. InnoDB stores the table itself in primary-key order, so a locking query through a secondary index locks both the matching index entry and the underlying table row.

Shopify instead made the columns used by the reservation query part of the primary key:

```
PRIMARY KEY (shop_id, inventory_item_id, inventory_group_id, id)
```

The query can now scan and lock the table rows directly. That means one lock per reservation unit instead of two, cutting the lock traffic on the hottest path in half.

The second problem appeared when a pool was empty. Under REPEATABLE READ, MySQL’s default [isolation level](https://www.hellointerview.com/learn/system-design/patterns/dealing-with-contention#isolation-levels), a locking query does not only lock the rows it finds. It also locks the gaps between them so another transaction cannot insert a new row into the range while the query is running.

When the pool is empty, there are no rows to lock, so the query locks the gap at the end of the index instead. That is exactly where the replenishment process needs to insert new rows. Reservation queries could therefore block replenishment or deadlock with it.

Shopify moved these transactions to READ COMMITTED, where the scan does not take those same gap locks. It was the first time Shopify had used a non-default isolation level anywhere in its codebase.

The final issue was a classic ordering deadlock. Different code paths touched the reservation tables in different orders, so two transactions could each hold a lock the other needed.

The fix, consistent with what we recommend [here](https://www.hellointerview.com/learn/system-design/patterns/dealing-with-contention#how-do-you-prevent-deadlocks-with-pessimistic-locking), was to make every path acquire locks in the same sequence. A reservation now removes rows from reservation\_units before inserting the hold into reserved\_quantities, matching the order shown above. With every transaction following the same order, the cycle disappears.

## What happens when payment never completes

This is one part of the system that the blog post doesn't touch on, but it's arguably amongst the most interesting aspects. Just because a user reserved inventory does not mean they are certain to purchase. There are three main states following a reservation:

1. Successful payment: Shopify claims the items, permanently deducting them from the merchant's ledger.
2. Payment fails or the user exits checkout: the system gets an explicit signal and releases the hold.
3. The reservation window expires: an item isn't reserved indefinitely, most sites set a timer of ~10 minutes, and when it runs out the hold has to die on its own.

The post covers the first and never mentions the other two. The second is easy enough, since the payment failure itself triggers the release. It's the third that's interesting. A closed laptop sends no signal at all, and if nothing gives those units back, a flash sale reads as sold out while the warehouse still has stock.

Whatever handles it can't be the buyer's browser or the server that took the original request, since both may be gone by the time the clock runs out. The deadline has to live in the data, and something still running has to act when it passes. The post doesn't say what that something was, so here's our best guess for each era of the design.

### Expiring holds in Redis (Old System)

For the old Redis system, the tempting answer is a TTL. Redis will happily delete a key a set number of seconds after it's written, which sounds like exactly what an expiring hold needs. But Shopify kept one counter per item, incremented and decremented as holds came and went. A TTL on that key would delete the whole counter, not one buyer's hold. Making TTLs work would mean a separate key per reservation, which is a fairly common pattern. It's how Redis distributed locks work, and it's the design we recommend in our [Ticketmaster breakdown](https://www.hellointerview.com/learn/system-design/problem-breakdowns/ticketmaster#1-how-do-we-improve-the-booking-experience-by-reserving-tickets). For locks it's the right tool, because a lock guards one specific thing. The key is the seat, the next buyer checks availability by trying to take that exact key, and the key's existence is the entire state. When it dies, cleanup is finished.

Shopify's inventory doesn't work that way. Nobody reserves hoodie #37, they reserve any one of 500 identical hoodies, so availability is a count across every live hold. And Redis has no fast way to get that count from a pile of per-reservation keys. The keyspace is just a flat hash table, so finding every hold:\* key means scanning all of it, which is O(n) across all keys. Not something you can do every time someone goes to reserve. That's why the counter exists in the first place. But with a counter, a hold's expiration has to trigger a write somewhere else, the INCR that gives the unit back, and Redis expiry doesn't run side effects. It just deletes the key. Worse, the deletion destroys the only record that the hold ever existed.

Redis can patch over that with [keyspace notifications](https://redis.io/docs/latest/develop/pubsub/keyspace-notifications/), publishing an expired event that a worker turns into the INCR. But those notifications are fire-and-forget pub/sub. If the worker is disconnected when the event fires, or crashes after reading it but before writing, the event is gone.

So instead of letting Redis delete the record, keep it until you've handled it. A sorted set can do exactly that. Each hold goes in scored by its deadline, so asking "what has expired" is just asking for every member with a score before now. Background workers (or cron jobs) continuously pop the ones that have come due, and an atomic script removes each hold and restores the counter in one step, so no two runs can grab the same hold. The downside is that you're subject to the frequency with which the workers run. For most inventory nobody notices, but for a hot item in a flash sale, even a few seconds of dead holds sitting unreclaimed reads as sold out to buyers who would have paid.

Alternatively, you can have the reclaim happen as part of the reserve itself. When a user reserves, the same atomic script first peeks at the head of the sorted set, reclaims a handful of holds that are past due, and only then takes the new reservation.

```
# one atomic script, run on every reserve
ZRANGEBYSCORE holds:hoodie -inf <now> LIMIT 0 10   # find up to 10 past-due holds
ZREM holds:hoodie res:41                           # drop each one from the set
INCR available:hoodie                              # and give its unit back

GET available:hoodie                               # confirm a unit is left, else stop
DECR available:hoodie                              # take the new unit
ZADD holds:hoodie <now + 600> res:87               # and schedule its expiry
```

The cap on how many holds one script reclaims matters, because Redis blocks every other command while a script runs, so draining an unbounded backlog inline would stall every buyer behind it. And items whose traffic dies never get another reserve to clean them up, so you still want the background workers sweeping the long tail.

### Expiring holds in MySQL (New System)

With the new design, when a user reserves, one transaction grabs rows from the pool with FOR UPDATE SKIP LOCKED, deletes them, and writes a single hold to the reserved\_quantities with the quantity and an expires\_at deadline. When payment succeeds, the claim deletes that hold and deducts the ledger. But when payment never completes, the hold just sits there, and the pool rows it consumed are already gone. Something has to put that capacity back.

The nice part is that nothing needs to fire when the deadline passes. The pool is already maintained by replenishment, which computes what it should hold, roughly the ledger count minus whatever active holds have taken. Define "active" as holds whose expires\_at is still in the future and expiry takes care of itself. The moment a deadline passes, the hold stops counting, and the next refill, background or inline, restores the capacity on its own.

```
-- units currently held, as seen by replenishment
SELECT SUM(quantity) FROM reserved_quantities
WHERE inventory_item_id = 42
  AND expires_at > NOW();
```

This is the question the Redis design was fighting. With per-reservation keys it took a full keyspace scan, so Shopify kept a counter instead, and the counter is what forced every release to be pushed as a write. Here it's just an indexed WHERE clause, similar to checking expires\_at in the availability query in our [Ticketmaster breakdown](https://www.hellointerview.com/learn/system-design/problem-breakdowns/ticketmaster#1-how-do-we-improve-the-booking-experience-by-reserving-tickets).

You still want a cleanup job sweeping dead holds, but it's garbage collection, not correctness. It keeps the table from bloating and keeps it honest for everything else that reads it, since a reserved-but-expired row looks reserved to any query that forgets the filter. If the sweep runs late, nothing breaks and no sale is lost. And to be clear, nobody is holding a database lock for the 10 minute reservation window. The hold is just a row with a deadline in it. Locks only appear inside the short transactions that touch it, each lasting milliseconds.

## Conclusion

The requirement was that reserve and claim commit together with the ledger, and only rows living in the same database as that ledger can deliver it. Redis counted concurrent decrements correctly the whole time and still had to go, because it couldn't take part in the ledger's transactions. The post closes on "If you're reaching for Redis, Kafka, or a custom coordination layer for high-throughput mutual exclusion, your existing database might already be enough," and the useful version of that advice starts with atomicity. If a hold and the record it guards must commit together, put them in the same database. If they don't need to, a Redis counter is still the simpler tool, and nothing in this story argues against it.

None of this was possible before MySQL 8 shipped SKIP LOCKED, which is why the conclusion that MySQL couldn't handle this workload was correct when Shopify first reached it and wrong by the time they revisited it. If your team ruled out the plain database years ago, the reasons behind that call are worth rechecking against what the database can do today.

The bounded pool deserves a close look before you copy it, because that's where the operational cost landed. Replenishment is a new process to run, monitor, and page on, and its natural failure mode is an empty pool in the middle of a flash sale. Shopify traded a Redis cluster for that process, one moving part for another, and the trade came out ahead because the new part lives inside the transaction boundary that mattered.

[Read the original at Shopify Engineering](https://shopify.engineering/scaling-inventory-reservations)

Mark as read

[Next: Discord Message Storage](https://www.hellointerview.com/learn/system-design/in-the-wild/discord-messages-scylladb)

<div class="comments-container w-full max-w-full min-w-0 overflow-x-hidden overflow-y-hidden pb-6"
