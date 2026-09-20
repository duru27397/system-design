# Flash Sale

> Source: [https://www.hellointerview.com/learn/system-design/problem-breakdowns/flash-sale](https://www.hellointerview.com/learn/system-design/problem-breakdowns/flash-sale)

---

# Flash Sale

By[Evan King](https://www.linkedin.com/in/evan-king-40072280/)·Published Sep 4, 2026·

hard

## Understanding the Problem

**👟 What is a flash sale system?**
Unlike many system design interviews, where we design an entire product, this problem zooms in on one particularly challenging part of an e-commerce system: selling a very limited amount of inventory under extreme demand.

To make the problem concrete, imagine Nike is releasing 10,000 pairs of a limited-edition shoe at noon. Tens of millions of users may attempt to purchase them within seconds.

Our job is to design the system that allows those users to fairly compete for the available inventory and complete their purchases without ever overselling.

### [Functional Requirements](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery#1-functional-requirements)

**Core Requirements**

1. Users can view the flash sale item.
2. Users can secure/reserve an available unit for a limited time while the sale is active.
3. Users who secure a unit can complete payment to purchase it.

The second requirement is the one candidates most often miss. It's tempting to go straight from viewing the product to buying it, but payment runs through a third party and takes seconds, and you can't hold inventory in an open database transaction that whole time. The reservation is what lets you take a unit off the table immediately and settle the money afterward. If you skip it, most interviewers will point you back toward it, though arriving there yourself is better than being led.

**Below the line (out of scope):**

1. Users can browse or search a broader product catalog.
2. Users can manage shipping, returns, refunds, or order history.
3. Administrators can create, configure, or manage flash sales.

FIRST QUESTION

What are the non-functional requirements for this system?

!

Try it yourself first

We recommend you to practice the question yourself first to get instant personalized feedback as you go.

### [Non-Functional Requirements](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery#2-non-functional-requirements)

Unlike functional requirements, non-functional requirements describe the system qualities that matter to users. These are usually phrased as "the system should be able to..." statements.

**Core Requirements**

1. The system should be able to prevent overselling, even when many people are trying to claim the same unit at the same moment.
2. The system should be able to handle millions of users arriving within seconds of the sale starting.
3. The system should be able to give users a fair opportunity to compete for the limited inventory.

**Below the line (out of scope):**

1. The system should protect user data and adhere to regulations like GDPR.
2. The system should be fault tolerant.
3. The system should provide secure transactions for purchases.

Here's how it might look on your whiteboard:

!

Requirements

## The Set Up

### Planning the Approach

Before moving on to the design, take a moment to plan your approach. Fortunately, the strategy should be straightforward if you follow the [Delivery Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery) and build the system up sequentially by satisfying each functional requirement one at a time.

This keeps you focused and prevents you from getting lost in the more interesting scaling problems too early. Once we've satisfied the functional requirements, we'll use the non-functional requirements to guide our deep dives.

### [Defining the Core Entities](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery#core-entities-2-minutes)

With the requirements in place, the first thing we recommend is defining the core entities, or the main nouns, in the system. At this stage, we don't need to worry about every column or field. We're simply identifying the data that will be central to our APIs and that we'll eventually need to persist.

Working our way through the functional requirements, we end up with four core entities:

1. **Product:** This is the shoe being sold in the flash sale. It includes the product details, price, sale start and end times, and the number of units available. A single pair is one unit of that product.
2. **Reservation:** A temporary claim on one unit of inventory while a user completes checkout. It tracks the user, product, expiration time, and current status.
3. **Purchase:** The record of a successful purchase, tying together the user, product, reservation, payment amount, and payment status.
4. **User:** The person attempting to participate in the flash sale and purchase the product.

In the actual interview, this can be as simple as a short list like this. Just make sure you talk through the entities with your interviewer so you're both on the same page before moving on.

!

Entities

### [API or System Interface](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery#api-or-system-interface-5-minutes)

With our core entities defined, we can move on to the APIs. We'll simply walk through our functional requirements one by one and define the external API needed to support each one.

Our first requirement is that users can view the flash sale item. For this, we need a simple GET endpoint that takes a productId and returns the corresponding product.

```
GET /products/:productId -> Product
```

The returned Product contains the information needed to render the sale page, including the product details, price, sale window, and number of units available.

Next, users need to be able to secure an available unit for a limited period of time. We'll expose a POST endpoint that attempts to create a reservation for the given product.

```
POST /products/:productId/reservations -> Reservation
```

If inventory is available, the system creates the reservation and returns it to the client. The Reservation the client gets back is a reservationId, the productId it covers, and an expiresAt timestamp, which is everything the client needs to show a countdown and then call the purchase endpoint. Importantly, this does not mean the user has purchased the unit yet. It simply gives them a limited window to complete checkout. How we safely create these reservations when millions of users are competing for the same inventory will be one of the main challenges we'll address later.

Finally, a user with an active reservation needs to be able to complete their purchase.

```
POST /reservations/:reservationId/purchases -> Purchase
```

This endpoint attempts to charge the user and convert their reservation into a completed purchase. If the reservation has expired or payment fails, the request will fail and the inventory can eventually become available to another user.

In an interview, this is about as much detail as you need at this stage. Your interviewer can usually infer the request and response fields from the entities and requirements we've already defined. We can always evolve these APIs later as the design becomes more sophisticated.

## [High-Level Design](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery#high-level-design-10-15-minutes)

### 1) Users can view the flash sale item

Let's start with our first functional requirement. When a user navigates to the flash sale page, they should see the product details and how many units are still available. This is a simple read path. The client calls GET /products/:productId, our backend looks up the corresponding product in the database, and returns it to the client. For now, we'll keep the available inventory directly on the product row as an inventoryCount.

!

View product

There are four main components involved:

1. **Client:** Users interact with the flash sale through our website or mobile app. Requests from the client are sent to our backend through the API Gateway.
2. **API Gateway:** The entry point to our backend. It routes requests to the appropriate service and can also handle cross-cutting concerns like authentication, rate limiting, and logging.
3. **Sale Service:** Our application service responsible for handling the flash sale APIs. For this first requirement, it handles requests to view a product by fetching the product from the database and returning it to the client.
4. **Database:** Stores our persistent data. We'll use Postgres so we can lean on its ACID guarantees for our correctness goals later on. For now, we only care about the Product table, which contains fields like productId, inventoryCount, price, saleStartTime, and saleEndTime.

Let's walk through what happens when a user opens the flash sale page:

1. The client sends a REST GET /products/:productId request.
2. The API Gateway forwards the request to the Sale Service.
3. The Sale Service queries the database for the corresponding product.
4. The product details, including the current inventoryCount, are returned to the client.

Easy!

### 2) Users can secure/reserve an available unit for a limited time while the sale is active

Next, we need to let a user temporarily secure one of the available units while they complete checkout. To support this, we'll add a Reservation table to our database. Each reservation records the userId, productId, its current status, and an expiresAt timestamp that gives the user a limited window to complete their purchase.

!

Reserve item

When the client calls POST /products/:productId/reservations, the Sale Service checks that inventory is still available, creates a reservation, and decrements the product's inventoryCount by one.

The flow looks like this:

1. The client sends POST /products/:productId/reservations.
2. The API Gateway forwards the request to the Sale Service.
3. The Sale Service opens a transaction and checks that the product is on sale and has inventory remaining.
4. It inserts a new row into the Reservation table with an expiration time, say 10 minutes in the future.
5. It decrements the product's inventoryCount by one and commits the transaction.
6. The reservation is returned to the client, giving the user until expiresAt to complete their purchase.

Steps 3 through 5 have to be a single transaction. If the check and the decrement can be pulled apart, two users can both read the same last unit as available and both walk away with a reservation for it, which is the overselling our requirements rule out.

Of course, not everyone who reserves a unit will actually buy it. A user might close the tab, have their payment declined, or change their mind. We need those reservations to eventually expire so the inventory isn't locked forever.

For now, we'll handle this with a simple cron job that runs periodically. It queries for active reservations whose expiresAt time has passed, marks them as expired, and increments the corresponding product's inventoryCount to make those units available again. Like the reservation itself, that pair of writes happens in a transaction. If we expired a reservation without returning its unit, we'd lose inventory that nobody can buy.

!

Reservation expiry cron

This means an expired unit might take a short period of time to return to inventory depending on how frequently the job runs, but that's fine for our initial design. We'll improve it in the deep dives when we worry about scale.

### 3) Users who secure a unit can complete payment to purchase it

Finally, users with an active reservation need to be able to complete their purchase. We'll add a Purchase table to track the payment and use an external payment processor like Stripe so we don't need to handle sensitive payment details ourselves.

!

Purchase

When the client calls POST /reservations/:reservationId/purchases, the Sale Service first verifies that the reservation is still active. It then creates a Purchase with a status of PENDING and asks Stripe to create a PaymentIntent for the purchase. Stripe returns a client secret, which we pass back to the client.

Payment processing is largely out of scope for this problem. If you want to understand the details behind PaymentIntents, payment state, retries, and safely integrating with an external processor like Stripe, check out our breakdown on [designing a Payment System](https://www.hellointerview.com/learn/system-design/problem-breakdowns/payment-system).

From there, the client communicates directly with Stripe to submit the user's payment details and confirm the payment. Once the payment succeeds or fails, Stripe sends a webhook to our Sale Service with the result.

A webhook is an HTTP request that one system sends to another when an event occurs. Here, rather than having our Sale Service repeatedly ask Stripe whether the payment succeeded, Stripe calls an endpoint on our backend once the payment reaches a final state, letting us know the status of the payment.

The full flow looks like this:

1. The client sends POST /reservations/:reservationId/purchases.
2. The API Gateway forwards the request to the Sale Service.
3. The Sale Service verifies that the reservation exists and has not expired.
4. It creates a Purchase with status = PENDING.
5. The Sale Service creates a Stripe PaymentIntent and returns the client secret to the client.
6. The client submits the payment details directly to Stripe and confirms the payment.
7. Stripe sends a webhook to the Sale Service with the result.
8. If the payment succeeds, the Sale Service marks the Purchase as COMPLETE and the Reservation as PURCHASED. If it fails, the Purchase is marked FAILED and the reservation remains active until it expires, giving the user a chance to retry.

!

Purchase webhook

One thing that flow leaves out is the user. Stripe tells the client the charge went through, but the record that matters to us, the Purchase marked COMPLETE and the Reservation marked PURCHASED, only lands when the webhook arrives a moment later. Until then the client doesn't know whether it got the shoe. The simplest fix is to have the client poll GET /purchases/:purchaseId every second or so until the status is final. Only the users holding reservations are polling, which is a few thousand people rather than the millions in the sale, so this costs us almost nothing. If you'd rather push, an SSE connection held open for those few seconds works too.

###### Pattern: Real-time Updates

Telling a buyer whether they got the shoe is a small instance of the realtime updates pattern. The set of waiting clients is tiny and the wait is a few seconds, which is where simple polling wins over a pushed connection. SSE makes more sense when more clients are waiting or they wait for longer.

[Learn This Pattern](https://www.hellointerview.com/learn/system-design/patterns/realtime-updates)

With that, we've satisfied all three of our functional requirements. We have a simple end-to-end design that lets users view the product, reserve limited inventory, and complete their purchase.

Of course, this design falls apart once tens of millions of users arrive at the same time. That's where our non-functional requirements come in.

## [Potential Deep Dives](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery#deep-dives-10-minutes)

### 1) How do we maintain consistency under extreme contention?

Our high-level design stores the remaining inventory as a single inventoryCount on the Product row. When a user creates a reservation, we need to decrement that count without ever allowing it to fall below zero.

A relational database can enforce this safely with a [conditional update](https://www.hellointerview.com/learn/system-design/patterns/dealing-with-contention#conditional-writes) like:

```
UPDATE Product
SET inventoryCount = inventoryCount - 1
WHERE productId = ? AND inventoryCount > 0;
```

If the update affects one row, we secured the inventory. If it affects zero rows, the product is sold out. We can perform this update and create the Reservation within the same transaction so the two changes happen atomically.

So correctness isn't the problem. But contention is.

That's because during the flash sale, potentially millions of reservation requests are all trying to update the same Product row. The database must serialize those writes because each decrement depends on the value produced by the previous one.

Think about how you'd do this in a store. With 10,000 pairs and a line out the door, you'd open ten registers and hand each cashier 1,000 pairs. Ten people get served at once. Our database can't do that. Every reservation reads the same inventoryCount, subtracts one, and writes it back, so the second request can't start until the first one commits. However many cashiers we hire, there's still only one register.

Even if we have hundreds of Sale Service instances and a heavily scaled database, this single row becomes a hot spot. Every request waits its turn for the row lock, and the more of them there are, the longer the wait. Adding application servers doesn't solve the problem either, because they all converge on the same bottleneck. We can only hand out inventory as quickly as the database can process those sequential updates.

Whatever solution we choose needs to preserve the invariant that we can never hand out more reservations than we have inventory, while handling extreme contention on that inventory.

###### Pattern: Dealing with Contention

A flash sale is the dealing with contention pattern in its purest form. Millions of users want the same 10,000 units at the same instant, and the system has to make sure each unit is handed out exactly once. The pattern covers the atomic claim techniques used here, from conditional updates and row locks to spreading contention across many rows.

[Learn This Pattern](https://www.hellointerview.com/learn/system-design/patterns/dealing-with-contention)

Let's look at our options.

### 

###### Approach

One way to handle the hot Product row is to move our highly contended reservation state into Redis. Redis keeps its data in memory and skips the disk writes, row locks, and transaction bookkeeping a relational database pays on every update, so a single Redis instance can process an order of magnitude more operations per second on one key than Postgres can on one row. Instead of storing the remaining inventory on the Product row, we'll maintain a Redis counter for each flash sale:

```
available:{productId} -> 10,000
```

When a reservation request arrives, the Sale Service checks that the counter is greater than zero and decrements it.

Redis is particularly well suited for this because command execution is serialized on its main execution thread. We don't have thousands of database transactions fighting over a row lock. Each decrement is executed one after another, atomically, in memory, making the critical section extremely fast.

!

Redis counter

But remember, a reservation isn't just a decrement. If the user doesn't complete their purchase, we need to know when their reservation expires so we can eventually add that unit back to the counter.

For that, we can keep a second data structure in Redis: a sorted set of active reservations. Each reservation ID is added with its expiresAt timestamp as the score.

```
expirations:{productId}

reservationA -> 12:10:03
reservationB -> 12:10:07
reservationC -> 12:10:12
```

Because sorted sets are ordered by score, our existing cleanup job can efficiently find reservations whose expiration time has passed, remove them, and increment the inventory counter.

We can also store the active reservation itself in Redis, keyed by reservationId, so the Sale Service can retrieve it when the user attempts to purchase.

Finally, decrementing the counter and recording the reservation can't be separate operations. If we decrement inventory and crash before recording the reservation, we've lost a unit. We can execute the check, decrement, and reservation writes together in a small Lua script, which Redis executes atomically.

###### Challenges

Redis dramatically increases the throughput of this critical path, but it introduces a couple of important tradeoffs.

First, our state is now split across two systems. Product and purchase data still live in our relational database, while available inventory and active reservations live in Redis. Redis is no longer just a cache. During the sale, it's part of our source of truth. That means we need to think carefully about durability, recovery, and how this state eventually reconciles with our persistent database.

Second, we haven't actually removed serialization. Every reservation for this product still needs to update the same Redis counter. We've just moved that serialization somewhere much faster. A single Redis instance can handle on the order of hundreds of thousands of simple operations per second depending on the workload, but it still has a finite ceiling. If millions of users are allowed to hammer this key at once, Redis itself eventually becomes the bottleneck.

### 

###### Approach

Rather than moving our hot counter to Redis, we can fix the underlying data model so there is no single row for every reservation request to contend on.

Instead of representing 10,000 available shoes with:

```
inventoryCount = 10,000
```

we create a pool containing one row for each reservable unit:

```
ReservationUnit
productId | unitId
------------------
shoe-123  | 1
shoe-123  | 2
shoe-123  | 3
...
shoe-123  | 10000
```

Now each available shoe is represented by its own independently lockable row. When a user tries to reserve one, our transaction simply needs to claim any available row from this pool.

The obvious way to do that would be:

```
SELECT unitId
FROM ReservationUnit
WHERE productId = ?
LIMIT 1
FOR UPDATE;
```

FOR UPDATE tells the database to lock the selected row until our transaction finishes. This prevents two transactions from claiming the same unit.

But there's still a problem. Imagine thousands of transactions execute this query at once. Many of them may initially select the same first available row. One transaction acquires its lock, while the others sit and wait.

There's an additional Postgres wrinkle here. Under READ COMMITTED, if the transaction holding the lock deletes that unit before a waiting transaction acquires it, the waiter can end up returning no row. With LIMIT 1, that can make the request appear sold out even though other reservation units are still available.

This is where SKIP LOCKED becomes useful:

```
SELECT unitId
FROM ReservationUnit
WHERE productId = ?
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

Instead of waiting on a row another transaction has already locked, SKIP LOCKED tells the database to skip it and keep looking for another available unit.

So if transaction A locks unit 37, transaction B doesn't wait for unit 37. It skips it and locks unit 38. Transaction C might grab unit 39, and so on.

We've effectively transformed one heavily contended inventory counter into thousands of independent pieces of inventory that can be claimed in parallel.

SKIP LOCKED is Postgres vocabulary, and MySQL uses the same. But if the keyword isn't on the tip of your tongue, that's fine. Once each unit has its own claimable row, any database that can lock rows independently will do.

Once we've claimed a unit, the rest happens inside the same short database transaction:

1. Select one ReservationUnit using FOR UPDATE SKIP LOCKED.
2. If no row is returned, the product is sold out.
3. Delete the claimed ReservationUnit.
4. Insert the corresponding Reservation with its expiresAt timestamp.
5. Commit the transaction.

Because the inventory claim and reservation are both stored in the same database, they commit atomically. We can't consume inventory without creating a reservation, or create a reservation without consuming inventory.

!

Reservation units

Our existing expiration flow still works as well. When a reservation expires, the cleanup job marks it as expired and returns a row to the ReservationUnit pool. We'll improve that flow in the next deep dive.

This is the same basic technique [Shopify adopted for its inventory reservation system](https://www.hellointerview.com/learn/system-design/in-the-wild/shopify-inventory-reservations). Rather than forcing every checkout to update a single quantity row, Shopify spread the contention across a pool of independently lockable reservation rows.

###### Challenges

The biggest tradeoff is that we're exchanging one compact counter for many database rows. Instead of storing inventoryCount = 10,000, our 10,000-pair flash sale now needs up to 10,000 reservation-unit rows.

For our problem, that's completely reasonable. But at the scale of a platform like Shopify, where millions of products may each have large inventories, creating one row for every physical unit would become wasteful. One way to address this is to maintain only a bounded pool of reservable rows and replenish it as the pool gets low rather than materializing the entire inventory upfront.

There is also still a limit to how much concurrent work our relational database can handle. We've eliminated the single hot-row bottleneck, but tens of millions of users should still not be allowed to open database transactions simultaneously. We'll handle that later when we introduce admission control.

The big advantage over Redis is that our inventory and reservations remain inside one transactional database. We get parallel reservation processing without introducing a second source of truth for our most important consistency invariant.

Between these two approaches, we'll move forward with the ReservationUnit design. Redis gives us a much faster serialization point, but it still leaves us with a hot key and splits our source of truth across two systems. By spreading inventory across independently lockable rows, we can process reservations concurrently while keeping the inventory claim and reservation in the same database transaction.

### 2) How do we efficiently release expired reservations?

Now that we can safely hand out reservations under heavy contention, we need to deal with the other side of the lifecycle and get inventory back when those reservations expire.

In our high-level design, we handled this with a simple cron job. Every few seconds, it queried for active reservations whose expiresAt was in the past, marked them as EXPIRED, and returned a unit to the available ReservationUnit pool.

If you've read any of our other breakdowns, you likely already see the issue with this approach. The reservation may expire at 12:10:01, but if our cleanup job doesn't run until 12:10:10, that unit remains unavailable for another nine seconds. During that window, a user could be told the product is sold out even though inventory has already expired and should be available for purchase. In a flash sale, where every unit matters, we need to make that inventory available the moment the reservation expires.

Let's weigh our options for pulling this off.

### 

###### Approach

A straightforward way to return inventory closer to the exact expiration time is to schedule a delayed job when we create each reservation.

For our 10-minute reservation window, we could use a delayed queue like Amazon SQS. When we create a reservation at 12:00:00, we also publish an ExpireReservation(reservationId) message with a 10-minute delay. SQS keeps the message hidden until roughly 12:10:00, at which point it becomes available for a worker to process.

!

SQS delayed expiration

When the worker receives the message, it can't blindly return the inventory. The user may have completed their purchase just before the expiration time, or the same message may be delivered more than once. Instead, the worker performs a short database transaction that:

1. Checks that the reservation is still ACTIVE and expiresAt <= now.
2. Marks the reservation as EXPIRED.
3. Returns a unit to the ReservationUnit pool.
4. Commits the transaction.

If the reservation has already been marked PURCHASED or EXPIRED, there is nothing left to do.

Other durable schedulers could work here too, like a Temporal timer. What matters is that the expiration job is scheduled durably outside the Sale Service. If the Sale Service instance that created the reservation crashes or restarts, we don't want the expiration timer to disappear with it.

###### Challenges

The biggest challenge is scale. A large flash sale can create thousands or millions of reservations in a short window, which means we're also creating thousands or millions of delayed messages that become eligible for processing around the same time.

We're also not guaranteed that a job runs at the exact moment the reservation expires. Queues can back up, workers can fail, and messages can be retried.

### 

###### Approach

We can avoid scheduling expiration work entirely by changing when we reclaim the inventory.

Remember the actual problem we're trying to solve. We don't care whether an expired unit is physically returned to the ReservationUnit pool at exactly 12:10:01. We care that a buyer who arrives next, whether at 12:10:02 or later, isn't incorrectly told the product is sold out.

So instead of pushing expired inventory back into the pool when a timer fires, we can reclaim it on demand when buyers actually need it.

The normal reservation path doesn't change. We first try to claim an available ReservationUnit using FOR UPDATE SKIP LOCKED, and as long as units remain in the pool, that's all we need to do.

The interesting case is when no available unit is found. Before returning "sold out," we check whether some existing reservations have already expired. If they have, we reclaim them in a batch:

1. Try to claim an available ReservationUnit as usual.
2. If none are available, find a batch of ACTIVE reservations where expiresAt <= now.
3. Mark those reservations as EXPIRED.
4. Keep one of the reclaimed units for this request and create its Reservation.
5. Return the remaining unitIds to the ReservationUnit pool.
6. Commit the transaction.

The request that reclaims the batch should keep one of those units. Otherwise it releases all 50 into the pool and then races everyone else for one.

For example, if the pool is empty but 50 reservations have expired, one reclamation pass reclaims all 50, keeps one for the buyer who triggered it, and returns the other 49 to the pool. Waiting buyers then claim those units through the same SKIP LOCKED flow we already designed.

But what happens if thousands of buyers hit the empty pool at the same time? We don't want all of them querying for expired reservations and trying to refill the pool.

Instead, we allow only one request at a time to try to reclaim expired reservations for a given product. The first request that finds the pool empty acquires a short-lived per-product lock and reclaims a batch of expired reservations. This way, the other requests don't perform the same work. They simply wait briefly or retry the normal reservation query.

The flow now looks like:

1. Many buyers discover that the ReservationUnit pool is empty.
2. One request acquires the reclamation lock for that productId.
3. That request keeps one unit for itself and returns the rest to the pool.
4. It releases the lock.
5. The waiting requests retry and spread across those newly available rows using SKIP LOCKED.

In Postgres, we could implement this with a transaction-scoped advisory lock keyed by productId. The exact locking mechanism isn't especially important. What matters is that only one request does the relatively expensive reclamation work while everyone else stays on the normal reservation path.

###### Challenges

The tradeoff is that the occasional reservation request now has to do more work. If the available pool is empty, one request may need to reclaim a batch of expired reservations before buyers can continue.

But the common path remains fast. Most buyers simply claim an available unit, while reclamation only happens when the pool actually needs it. We also avoid creating millions of individual expiration jobs and no longer depend on a background process running at exactly the right moment.

### 3) How do we handle millions of users arriving at once?

At this point, we've removed the hot-row bottleneck and made our reservation flow safe under contention. But the database still has a physical limit.

Suppose load testing shows that our database can safely process around 10,000 reservation transactions per second. If hundreds of thousands or millions of users are allowed to attempt reservations at once, requests will still arrive faster than the database can process them. They'll pile up, latency will climb, and eventually requests will begin timing out or overwhelming the system.

There isn't another clever query that solves this. We've reached a capacity limit of the infrastructure itself. Even if we had chosen Redis in the previous deep dive and pushed that ceiling much higher, there would still be some maximum rate the reservation system could safely handle.

So instead of trying to make the reservation path accept unlimited traffic, we need to move upstream and control how quickly users are allowed to reach it.

###### Pattern: Scaling Writes

With the hot row gone, what's left is a scaling writes problem. Reservation requests arrive faster than any single database can commit them, and the scaling writes pattern covers the tools for that, from partitioning writes across many rows (which we just did with ReservationUnit) to absorbing bursts with queues and load shedding, which is the job of the waiting room below.

[Learn This Pattern](https://www.hellointerview.com/learn/system-design/patterns/scaling-writes)

Let's look at how we can introduce admission control.

### 

###### Approach

The simplest way to protect the database is to rate limit reservation requests at the API Gateway.

If load testing tells us the reservation system can safely process around 10,000 requests per second, we can configure the gateway to allow roughly that rate through and reject anything above it with a 429 Too Many Requests.

!

Gateway rate limit

It's crude, but it does ensure the database never receives more traffic than it can safely handle.

###### Challenges

The problem is that we've protected the backend by pushing the pain directly onto the user.

During the flash sale, millions of users may hit the reservation endpoint at once. Most of them would receive a 429 and immediately retry. Those retries create another spike, which gets rate limited again, and we quickly end up with a thundering herd of clients repeatedly hammering the gateway.

### 

###### Approach

Instead of rejecting users when the reservation system reaches capacity, we can hold them upstream in a virtual waiting room and admit them at a rate our backend can safely handle.

When the flash sale begins, users first enter the waiting room rather than going directly to the reservation endpoint. The new Waiting Room Service records each user in Redis and returns an ID they can use to check their status while they wait.

We use a separate service because the waiting room may see orders of magnitude more traffic than the Sale Service, especially as millions of clients poll for their status. This lets us scale the two workloads independently.

!

Waiting room service

Meanwhile, an admission controller continuously lets users through at a controlled rate. If load testing tells us our reservation system can safely process 10,000 transactions per second, we might admit something like 8,000 users per second to leave some headroom.

The flow looks like this:

1. The user joins the waiting room.
2. Their place in the waiting room is stored in Redis.
3. The client periodically checks its status while it waits.
4. The admission controller admits users at a rate the reservation system can safely handle.
5. Once admitted, the user receives a short-lived signed admission token.
6. The client includes that token when it calls POST /products/:productId/reservations.
7. The API Gateway validates the token before allowing the request to reach the Sale Service.

The signed token ensures users can't bypass the waiting room and call the reservation endpoint directly. We can include fields like the userId, productId, and an expiration time in the token and sign it with a secret known to our backend. The API Gateway can then verify the signature without another database lookup.

Once a user is admitted, nothing about our reservation flow changes. They make the same synchronous request we already designed and immediately learn whether they secured a unit.

This gives us the property we're after. Millions of users can be waiting, but only a controlled number are allowed to perform the expensive reservation transaction each second.

!

Waiting room full design

If a single Redis instance can't comfortably handle the waiting-room state and polling traffic, we can shard the waiting room across multiple Redis instances. The state here is lightweight and can scale independently from the reservation system itself.

###### Challenges

The main challenge is choosing the right admission rate. Admit users too quickly and we overwhelm the reservation system. Admit them too slowly and we leave capacity unused while users wait unnecessarily.

We've also introduced an important new responsibility. The waiting room now decides who gets access to the scarce inventory and in what order.

We've solved the scalability problem, but that immediately raises our final question: how do we make that ordering fair?

### 4) How do we make access to limited inventory fair?

Our waiting room solves the scalability problem by controlling how quickly users reach the reservation system. But the moment we start deciding who gets admitted first, we also become responsible for making that ordering fair.

A naive approach would be pure FIFO. Whoever enters the waiting room first gets admitted first. The problem is that for a sale with a known start time, this turns the first few milliseconds into a competition over network latency and automation rather than giving everyone who showed up on time a reasonable chance.

Instead, we can open the waiting room before the sale begins but hold everyone there until noon. At noon, we randomly order everyone who is already waiting. Someone who joined at 11:55 has no advantage over someone who joined at 11:59:59. Once the sale has started, anyone new who arrives joins the back of the line in normal FIFO order.

This gives us a useful balance. Being there when the sale starts matters, but racing to be the first request through the door does not.

We also need to stop individual users from taking multiple places in line. The waiting room should require an authenticated account and allow only one active queue entry per user for a given sale. We can also put a CAPTCHA or similar bot challenge in front of the queue to make automated mass entry harder.

The signed admission token we introduced earlier ensures that users can't skip ahead once the ordering has been established. Only users explicitly admitted by the Waiting Room Service receive a valid token that allows them to reach the reservation endpoint.

Finally, if our waiting-room state is sharded across multiple Redis instances, the ordering still needs to be global. We don't want each shard independently deciding who goes next. Instead, each user gets an ordering value that lets the admission controller preserve the randomized pre-sale order followed by FIFO for everyone who arrives after the sale begins.

### Final Design

Putting it all together, our final design looks like this:

!

Final Design

## [What is Expected at Each Level?](https://www.hellointerview.com/blog/the-system-design-interview-what-is-expected-at-each-level)

There is a lot of interesting depth packed into this problem, and you're not likely to cover every detail in a ~35-minute interview. But what does matter depends heavily on the level you're interviewing for.

### Mid-level

A strong mid-level candidate should produce a complete end-to-end design for viewing the product, reserving inventory, and completing a purchase without overselling. They should understand that checking and decrementing inventory must happen atomically, but it's reasonable for the interviewer to guide them toward deeper issues like hot-row contention, admission control, or reservation expiration. A simple cleanup job is sufficient, while proactively landing on SKIP LOCKED or a waiting room would be a bonus.

### Senior

A strong senior candidate should move quickly through the basic design and proactively identify the problems that make a flash sale difficult. They should recognize the hot inventoryCount row, reason through approaches like Redis versus FOR UPDATE SKIP LOCKED, handle expired reservations cleanly, and recognize that the datastore still has a finite throughput ceiling. If pushed, they should introduce admission control, ideally a virtual waiting room, and be able to explain the tradeoffs behind the choices they make.

### Staff+

A strong staff+ candidate should drive nearly all of the deep dives without prompting. They should preserve the inventory invariant under extreme contention, reason quantitatively about backend capacity, design the reservation and reclamation paths without introducing new bottlenecks, and use a waiting room to keep the critical path within its limits. They should also proactively address fairness, including pre-sale randomization, FIFO after the sale begins, duplicate entries, bot resistance, and maintaining ordering as the waiting room scales.

###### Test Your Knowledge

Answer the question below to find your gaps.

Mark as read

[Next: Real-time Updates](https://www.hellointerview.com/learn/system-design/patterns/realtime-updates)

<div class="comments-container w-full max-w-full min-w-0 overflow-x-hidden overflow-y-hidden pb-6"
