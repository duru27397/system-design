# Change Data Capture

> Source: [https://www.hellointerview.com/learn/system-design/deep-dives/change-data-capture](https://www.hellointerview.com/learn/system-design/deep-dives/change-data-capture)

---

# Change Data Capture

Learn how change data capture streams database writes to caches, search indexes, and downstream services without dual writes.

You’re in a system design interview and you need to keep two data stores in sync. Maybe your primary database needs to feed a search index. Or perhaps you’re moving data into a warehouse to run offline analytics.

The answer here is usually change data capture (CDC), which works by reading changes from the database’s replication log and propagating them to downstream services. Often, CDC is exactly the right tool. But candidates also tend to reach for it in situations where CDC isn’t the best fit and an alternative would serve them better.

CDC works best when consumers just need a copy of your data. But it can start to fall apart when they need to know why that data changed. In this article, we’ll build a simple test you can use in an interview to decide when CDC is the right choice, when it creates subtle correctness problems, and what to use instead.

## What is CDC

Suppose your product catalog lives in [Postgres](https://www.hellointerview.com/learn/system-design/deep-dives/postgres), but you use [Elasticsearch](https://www.hellointerview.com/learn/system-design/deep-dives/elasticsearch) to power product search across your app. Postgres is the source of truth, but every time a product is created, updated, or deleted, you need that change reflected in Elasticsearch too.

One option is to have the application write to both systems so that when a product changes, the application updates Postgres and Elasticsearch at the same time. This seems simple enough, but if one write succeeds while the other fails, the two systems are now out of sync. You can retry the failed write, but now you need retry logic, idempotency, and some way to recover if the application crashes between the two operations.

!

Dual writing

Another option is polling. Every few seconds, a cron job could query Postgres to figure out what changed and update Elasticsearch accordingly. This can work too, but now you are repeatedly querying the database, introducing additional load and maintaining logic to determine which records changed since the previous poll.

!

Polling

Change Data Capture, or CDC, lets you capture changes directly from the database as they happen and propagate them to downstream systems like Elasticsearch.

### How CDC works

CDC works by taking advantage of something your database is already doing. To survive crashes and keep replicas up to date, most databases write every change to an ordered log before it lands in the data files.

PostgreSQL calls this the Write-Ahead Log (WAL). MySQL has the binary log, which records every row change for replication. Most databases have something equivalent.

CDC is then able to read from these existing mechanisms directly instead of asking the application to perform another write. A typical architecture looks like this.

!

CDC

The application still writes only to Postgres. Postgres records those changes in its WAL as part of normal transaction processing, and once the transaction commits, CDC can expose them downstream.

A CDC connector then reads those committed changes and converts them into records that downstream systems can consume. [Debezium](https://debezium.io/) is a popular open source CDC platform that provides connectors for databases like PostgreSQL and MySQL. In the architecture above, Debezium publishes those change records into [Kafka](https://www.hellointerview.com/learn/system-design/deep-dives/kafka), and a consumer applies them to Elasticsearch. Kafka is the transport layer in the same Postgres-to-Elasticsearch pipeline.

Suppose an order changes from PROCESSING to SHIPPED. A simplified CDC record might look something like this.

```
{
  "table": "orders",
  "operation": "UPDATE",
  "before": {
    "id": 123,
    "status": "PROCESSING"
  },
  "after": {
    "id": 123,
    "status": "SHIPPED"
  },
  "offset": {
    "lsn": "24023128"
  }
}
```

The exact format varies by database and CDC tool, but the core pieces are usually similar. The operation tells the consumer whether the record was inserted, updated, or deleted. The before image contains the previous value, while the after image contains the new value. The source offset records where this change appeared in the database log so the CDC system can track its progress and resume from the correct position after a restart.

From there, consumers decide what to do with each change. Our search indexing service from earlier would do this with product changes, refreshing the corresponding document in Elasticsearch so that search results stay current. In another case, a data pipeline feeding a warehouse like Snowflake might ingest the same change to keep analytical tables in sync with production data.

None of these consumers participate in the original write. The application doesn’t know they exist, so you can add a new one without changing application code.

## When to use CDC

CDC is by far most useful when you have one system that is the source of truth and another system needs to maintain a derived copy of that data. Derived means you could throw the downstream system away and rebuild it from the source. Nothing lives there that doesn’t live somewhere else first.

Here are three common examples.

### Keeping a derived index in sync

Postgres holds the product catalog, Elasticsearch serves search, and CDC keeps the index current.

!

Derived index

It works because the index like Elasticsearch isn’t the source of truth, it’s a searchable projection of what’s in Postgres. That projection can lag a little without causing problems, so a price change might take a second or two to show up in search results while Postgres stays correct the whole time. If the index gets corrupted or drifts badly out of sync, you can drop it, rebuild from Postgres, and resume processing new changes.

### Replicating an OLTP database into a data warehouse

Imagine your application stores its production data in Postgres, while your analytics team queries that data from a separate data warehouse like Snowflake. This is a very common setup to reduce pressure on the production database.

A traditional approach is to periodically run a batch job that copies data from Postgres into the warehouse. This works, but large batch reads can be expensive and put additional load on the production database, competing with application traffic for resources. They can also take a long time to complete, which limits how frequently you can reasonably run them. The warehouse is only as current as the last completed batch, and detecting updates and deletes can require additional bookkeeping.

!

CDC warehouse

CDC avoids repeatedly scanning large portions of the database by continuously capturing only the changes since the last processed position. It reads the replication log the database already maintains instead of adding another query path over the source tables. With CDC, every insert, update, and delete can be streamed into the warehouse as it occurs.

The production database remains the source of truth. Snowflake (or similar) contains a derived analytical representation of that data, and some replication lag is usually acceptable. If the warehouse pipeline breaks, you can repair the data from the source and continue processing changes.

### Zero-downtime database migration

CDC is also useful when migrating from one database to another. Suppose you want to move a large Postgres database to a new database without taking the application offline. Copying the database once is not enough because users will continue changing data while the copy is running.

Instead, you start CDC on the old database, then backfill the existing data into the new one. CDC captures anything that changes while the backfill runs, and once it finishes those changes are applied to the new database until it catches up. At that point, you can move reads to the new database and eventually move writes as well.

!

CDC migration

The alternative is dual writing, where the application sends every write to both databases until the migration finishes. That means migration logic living in your application code, and it has to stay correct the entire time both databases are taking writes. With CDC the application writes to one database the whole way through and never knows the migration is happening.

All three of the above examples have the same properties:

1. The source stays authoritative while CDC runs. Postgres remains the system of record while Elasticsearch, Snowflake, or the new database is being synchronized from it.
2. Some staleness is acceptable. The downstream system does not need to reflect every write before the original request can complete.
3. The target can be reconstructed or resynchronized from the source. If something goes wrong, you can rebuild or repair the downstream system while CDC keeps running.

## When not to use CDC

In all three of those cases, the downstream system only cares about state. Problems show up when the consumer needs something more than a faithful copy of that state.

The common failure mode is treating CDC like a reactive architecture where one row change kicks off the next action. What could have been a direct service call is now hidden behind a connector and consumer. A backfill or repair script can suddenly flood a downstream service, and failures are harder to trace because the original write gives no clue what it will trigger. That is a lot of machinery if the consumer only cares about a small fraction of the database's changes.

### Sending an email when an order ships

Suppose an order moves from PROCESSING to SHIPPED and you want to send the customer an email. It is tempting to listen for changes to the orders table and send an email whenever you see this.

```
{
  "table": "orders",
  "operation": "UPDATE",
  "before": {
    "id": 123,
    "status": "PROCESSING"
  },
  "after": {
    "id": 123,
    "status": "SHIPPED"
  }
}
```

At first glance, this seems reasonable. The consumer can clearly see that the order changed to SHIPPED.

The problem is that CDC knows that a row changed, but it has no idea why. A migration rewriting historical orders or a repair job fixing bad data could both produce the same change.

Now the email service has to infer a business event from the physical representation of your data. status = SHIPPED no longer just describes the state of an order. Other systems have implicitly agreed that setting this column means an OrderShipped event occurred.

That coupling becomes especially dangerous when the consumer performs a side effect like sending an email, charging a card, or triggering another workflow. For something like Elasticsearch this doesn't matter. Writing the same final state again is harmless. Sending the same customer a second shipping email is not.

Deduplicating CDC records does not solve this either. From the database's perspective, these are different writes at different positions in the log, so there is nothing for a dedup key to catch. What is missing is a durable business-level fact such as OrderShipped with its own event ID.

The application already knew the difference. When it set status = SHIPPED it was shipping an order, not repairing data, but nothing about that write records which one it was. By the time CDC reads the log, all that's left is a column that changed.

So have the application write it down. In the same transaction that updates the order, insert a row saying what happened.

```
BEGIN TRANSACTION;

UPDATE orders
SET status = 'SHIPPED'
WHERE id = 123;

INSERT INTO outbox_events (
  event_id,
  event_type,
  payload
)
VALUES (
  '8f12...',
  'OrderShipped',
  '{ ... }'
);

COMMIT;
```

Either both rows commit or neither does, so an OrderShipped row exists exactly when an order actually shipped. That's the transactional outbox, and a relay can publish those events downstream.

The important distinction is what the relay is reading.

orders.status is application state. An outbox row exists specifically because the application decided a business event happened. It gives downstream consumers an explicit event such as OrderShipped, along with a stable event\_id they can use for deduplication.

Use the outbox event, not a change to the orders table, as the contract with downstream consumers.

### Invalidating a cache when a row changes

Suppose your application serves user profiles from Redis and wants to invalidate the cached copy whenever the underlying row changes in Postgres. It can feel natural to watch the users table and delete the matching Redis key as updates arrive. It works, but it is often unnecessary.

In the common case, the application that changed the row already knows exactly which cache entry is now stale. It has the user ID in hand, in the same request and the same code path. Invalidating the key there is simple and immediate. Routing the same information through CDC means introducing a connector, topic, and consumer just to rediscover something the writer already knew.

Sometimes you don't need explicit invalidation at all. If serving a profile that is a minute out of date is acceptable, a short TTL may be enough.

The difference from the search index is that the cache does not need a durable stream of every change. A missed invalidation can age out through the TTL, and the value can be loaded again on demand.

### Running cleanup or background jobs after state changes

Suppose deleting an account should kick off some cleanup work. You need to remove its files from object storage, revoke API keys, and delete related data from other systems. You could watch the users table with CDC and start that work when a DELETE appears.

This has the same problem as the OrderShipped example. A DELETE tells you that a row disappeared, not that a particular cleanup job should run. But background work introduces another problem too. Kafka can deliver CDC records durably, and consumers can add retries. But once the consumer also owns job state, backoff, failure handling, and delayed execution, you have built a job system around an implicit row change.

This becomes even clearer with delayed work. Suppose a reservation expires 30 minutes after it is created and then needs to release inventory. CDC can tell you that the reservation was inserted, but now the consumer has to persist a timer somewhere, recover it after crashes, and make sure the cleanup eventually runs. Kafka does not change that. The timer and its recovery still need to live somewhere.

If the application already knows that some work needs to happen, it is usually better to represent that work directly. Enqueue a durable job for immediate background work, or start a durable workflow with an execution engine like Temporal when the work is long-running, delayed, or involves multiple steps.

## Conclusion

CDC reads the log your database already keeps for crash recovery and replication and turns it into a stream other systems can consume. The application keeps writing to one database, and consumers can be added or removed behind it without touching that code.

Use it when the downstream system just needs a copy of your data. A search index, an analytics warehouse, a database you are migrating onto. The source stays authoritative the whole time, a little lag is fine, and if the target drifts you can rebuild it.

Be careful not to use CDC as a generic trigger for whatever should happen next. Business intent should be written down as an explicit event, and work the application already knows about should be called or queued directly. Once a consumer needs retries, backoff, or scheduling, you wanted a job or workflow system, not CDC.

In an interview, use CDC when the problem cleanly fits one of the derived-copy archetypes above. If the application already knows what should happen next, make that dependency explicit.

###### Test Your Knowledge

Answer the question below to find your gaps.

Mark as read

[Next: Shopify Inventory Reservations](https://www.hellointerview.com/learn/system-design/in-the-wild/shopify-inventory-reservations)

<div class="comments-container w-full max-w-full min-w-0 overflow-x-hidden overflow-y-hidden pb-6"
