# 5 Techniques Meta Uses to Scale a Database to Millions of Clients

> Source: [https://www.hellointerview.com/learn/system-design/in-the-wild/meta-zgateway-zippydb](https://www.hellointerview.com/learn/system-design/in-the-wild/meta-zgateway-zippydb)

---

# 5 Techniques Meta Uses to Scale a Database to Millions of Clients

By[Evan King](https://www.linkedin.com/in/evan-king-40072280/)·Published Sep 16, 2026

###### Read the Source Blog

Originally published by Meta Engineering on September 3, 2026

[View](https://engineering.fb.com/2026/09/03/core-infra/zgateway-proxy-zippydb-meta/)

## The TLDR

Meta's [ZippyDB](https://engineering.fb.com/2021/08/06/core-infra/zippydb/) gives hundreds of internal teams a shared database for fast key-value lookups. With more than a million client machines using it, managing connections and repeated requests becomes a massive scaling problem.

Meta added a reverse proxy they named ZGateway to coordinate that traffic before it reaches the database. By bringing requests through one shared service, the ZippyDB team can reuse connections and avoid repeating work for different callers. The team can also turn away excess traffic before it overwhelms storage.

This is our [Scaling Reads](https://www.hellointerview.com/learn/system-design/patterns/scaling-reads) and [Scaling Writes](https://www.hellointerview.com/learn/system-design/patterns/scaling-writes) playbook in production. We'll walk through five familiar techniques and see how each addresses a different bottleneck.

## The problem

When many applications share a database, each opens its own connections and sends its own requests. The database has to maintain all those connections and answer each request, even when thousands of applications are asking for the same data.

And connections aren't free! Each one needs memory to track its state and buffer data, even while idle. Opening a connection also takes CPU time for authentication and setting up encryption. Meta [describes database hosts accepting tens of thousands of incoming connections](https://engineering.fb.com/2026/09/03/core-infra/zgateway-proxy-zippydb-meta/). If many applications restart together, the database has to re-establish their connections while still handling queries. And all that extra work can overwhelm it.

Then there's the work those applications actually ask it to do. Every small request has overhead to receive, decode, and process it. If a thousand applications read the same profile, the database may perform the same lookup a thousand times. If they ask again a second later, it does that work again, even if the profile hasn't changed.

All of this consumes capacity that other applications need. Worse yet, a traffic spike from one team can fill the queues and slow down everyone else, even if their traffic hasn't changed.

## The solution

Meta added a reverse proxy they named ZGateway between their internal applications and ZippyDB. Applications send their requests to the gateway, and the gateway handles the database connections on their behalf.

Because requests from different applications now pass through the same service, the gateway can combine work those applications would otherwise do separately. It also gives the ZippyDB team a place to control how much work gets through when traffic exceeds capacity.

There are five techniques they use to pull this off, and they're relevant to almost any system that needs to scale reads and writes.

Let's walk through them.

### 1. Connection pooling

[Connection pooling](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.howitworks.html#rds-proxy-connection-pooling) means keeping a set of database connections open and reusing them across requests. When an application needs to query the database, it uses a connection that's already established. Once the request finishes, that connection stays available for more work. This way we avoid paying the cost of opening, authenticating, and closing a connection for every query.

An application will often manage its own pool. That works well for reusing connections within that application, but each new application instance brings another pool. The database still has to maintain connections from all of them, even when many are idle.

In Meta's case, that's more than a million internal client hosts, each managing its own connections to the database hosts it needs. Meta describes typical clients holding tens of thousands of outgoing connections, with individual ZippyDB hosts accepting tens of thousands of incoming ones. Pooling within each client still leaves the database maintaining connections from all those separate clients.

By adding a gateway between the clients and the database shards, Meta can share those database connections across clients. Each client connects to a small set of ZGateway hosts, and the gateways forward its requests over their shared pools of connections to ZippyDB. A new client can use those existing backend connections instead of opening its own connections to every database host it needs.

!

Direct application-to-database connections compared with pooled connections through ZGateway.

### 2. Batching

Sharing connections reduces the cost of keeping applications connected, but the database still has to receive and process their individual requests. Batching lets several operations share that overhead.

Suppose three application instances send requests to fetch profiles 73, 81, and 92 for the same use case and database shard. Without batching, ZGateway could forward three separate requests to ZippyDB. Instead, it sends all three keys in a single backend request, then routes the individual results back to the correct callers.

The database still performs three lookups, but they share the overhead of serialization, network transmission, and handling a backend request. Those fixed costs would otherwise be paid once per operation.

The same idea works for writes. Several independent updates can travel together while still being applied as separate changes once they reach the database.

Batching also reduces the backend requests counted against a use case's [rate-limit budget](https://www.hellointerview.com/learn/system-design/problem-breakdowns/distributed-rate-limiter), letting it perform more operations before being throttled.

The tradeoff is that those requests won't necessarily arrive at the same time. When the request for profile 73 arrives, the gateway could send it immediately. Holding it briefly gives the requests for 81 and 92 a chance to join, so all three can share the overhead. But the caller asking for 73 now waits longer for its answer. The longer you wait, the more efficient the batches, but it also adds more delay before the database even starts the work.

!

Requests for keys 73, 81, and 92 accumulate until a batch flushes, sharing one backend request while still requiring three lookups.

ZGateway bounds this by flushing a batch when either a timer expires or the batch reaches a size or request-count limit. It also limits how many batches can be in flight at once to protect gateway memory when the database slows.

As in our [Scaling Writes pattern](https://www.hellointerview.com/learn/system-design/patterns/scaling-writes), the batch size and wait time need to fit the workload's latency budget.

### 3. Request coalescing

Now suppose the three requests arriving at a gateway all want user:73.

For a simplified example, caller A arrives first and the gateway begins a lookup against ZippyDB. Before that request finishes, callers B and C arrive asking for the same key. Rather than issue two additional database reads, the gateway can attach those callers to the lookup that is already in flight. When the result comes back, all three callers receive it.

This is **request coalescing**, the same technique we explored in our [Discord message-storage article](https://www.hellointerview.com/learn/system-design/in-the-wild/discord-messages-scylladb).

!

A timeline of three overlapping reads for user 73 sharing one in-flight database lookup and receiving the same result.

The difference from batching is how much work reaches the database. A batch containing three different keys still needs three lookups, even though they travel together. With coalescing, the callers are asking for the same thing, so one lookup can answer all of them. This becomes especially useful when a profile suddenly gets popular. Thousands of people might request it at once, and many of those reads can share a lookup instead of each creating more work for the database.

For that to happen, the requests need to reach the same gateway while the lookup is still running. They also need to refer to the same record with compatible read requirements. Each gateway tracks its own outstanding work, so it can't combine a request with a lookup happening on another gateway.

The tradeoff is the memory needed to keep track of all this. The gateway has to remember which lookups are running and which callers are waiting for each result. If the database slows down, those lookups take longer and more callers can accumulate behind them. The gateway needs limits on how much work it keeps outstanding, along with cleanup when requests finish or time out, so that waiting requests don't exhaust its memory.

Coalescing also stops helping once the lookup finishes. If someone asks for user:73 a moment after the result has been returned, there's no longer an in-flight request to join. We would have to read the profile again, even if it hasn't changed. To avoid that next read, we need to keep the result around, which brings us to caching.

### 4. Read-through caching

ZGateway also uses [read-through caching](https://www.hellointerview.com/learn/system-design/core-concepts/caching). The gateway checks its local in-memory cache first. If the value is missing, it fetches it from ZippyDB and saves a copy in memory, so later requests can get the result without another database read.

If a popular cache entry expires or is invalidated, many callers may request it at once. This can cause a thundering herd, where every caller tries to refill the same entry. ZGateway prevents that on each caching gateway with a per-key fill lock. One request fetches the value while the others wait for its result. It's the same coalescing idea from the previous section, with the result kept in the cache afterward.

!

A ZGateway cache hit returns directly to the caller. A miss fetches from ZippyDB under a per-key fill lock, while a separate CDC stream keeps cache entries fresh.

The tradeoff is that cached values can become stale. Meta uses a [change-data-capture stream](https://www.hellointerview.com/learn/system-design/deep-dives/change-data-capture) to invalidate or refresh them, with an agreed limit on how far cached reads can lag behind writes.

### 5. Admission control

Even after reducing unnecessary work, the database can still receive more traffic than it can handle. The last technique is admission control, which decides which requests to accept so that a spike from one team doesn't slow down everyone else.

ZGateway separates requests into bounded queues by use case and priority, then takes turns serving them. If one team's queue fills up, its excess requests can be rejected while other teams continue making progress. CPU and memory pressure also affect how much work the gateway accepts.

!

Team A fills its bounded queue and has excess traffic rejected, while Team B's separate queue continues to receive turns from the scheduler.

The tradeoff is that some callers get an error instead of having their requests wait. That protects capacity for work the system can finish, but callers need to back off before retrying or they'll recreate the same overload.

## Conclusion

ZGateway brings the familiar [Scaling Reads](https://www.hellointerview.com/learn/system-design/patterns/scaling-reads) and [Scaling Writes](https://www.hellointerview.com/learn/system-design/patterns/scaling-writes) techniques together in a service the ZippyDB team controls. Instead of leaving every application to manage its own connections and repeat the same database work, the gateway lets them share that work and keeps their combined traffic within what the database can handle.

The lesson is to understand where your database is spending its resources before deciding how to scale it. Once you know whether the problem is too many connections, repeated reads, or more traffic than it can serve, you can choose a technique that actually helps. At Meta's scale, all five earn their place, even with the extra latency and responsibility of running another service.

[Read the original at Meta Engineering](https://engineering.fb.com/2026/09/03/core-infra/zgateway-proxy-zippydb-meta/)

Mark as read

<div class="comments-container w-full max-w-full min-w-0 overflow-x-hidden overflow-y-hidden pb-6"
