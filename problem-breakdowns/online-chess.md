# Online Chess

> Source: [https://www.hellointerview.com/learn/system-design/problem-breakdowns/online-chess](https://www.hellointerview.com/learn/system-design/problem-breakdowns/online-chess)

---

# Online Chess

By[Evan King](https://www.linkedin.com/in/evan-king-40072280/)·Published Jun 29, 2026·

hard

## Understanding the Problem

**♟️ What is [Chess.com](https://www.chess.com/) / [Lichess](https://lichess.org/)?**
Online chess platforms let players find an opponent of similar skill, play a real-time game with a shared clock, and climb a global rating leaderboard. The server validates every move and owns both clocks, so neither player can cheat the rules or the time.

A quick primer if you don't play much. Two players alternate moves on a shared board, and each side has its own countdown clock set by the time control. Games run anywhere from classical at hours a side down to a minute a side in blitz and bullet, where players have only seconds per move and every bit of delay eats into their clock.

Players also carry a skill rating that drives who they get matched against and where they land on the leaderboard. We'll build a single game first, then use the deep dives for the parts that get hard at scale. That means matchmaking, running a large fleet of game servers, and keeping the clock fair across players with different network latency.

### [Functional Requirements](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery#1-functional-requirements)

Start by nailing down the top few functional requirements. Everything else is below the line. Calling those out shows product sense, but you won't design them, so keep the core list tight and check with your interviewer before moving on.

**Core Requirements**

1. Players should be able to find an opponent through skill-based matchmaking and start a game.
2. Players should be able to play a game in real time.
3. Players should be able to view a global leaderboard and see their own rank, both updating shortly after games finish.

**Below the line (out of scope)**

1. Spectating live games and broadcasting popular boards.
2. In-game chat, friends, and social features.
3. Puzzles, training, and post-game analysis or replay.
4. Tournaments and arena play.
5. Anti-cheat and engine-detection (fair play), plus tournament integrity. We'll come back to why this one is interesting but out of scope at the end.

FIRST QUESTION

What are the non-functional requirements for this system?

!

Try it yourself first

We recommend you to practice the question yourself first to get instant personalized feedback as you go.

### [Non-Functional Requirements](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery#2-non-functional-requirements)

Before the requirements, let's pin down the scale, since it drives most of the design. We'll design for 500K concurrent games at peak. Each game has two players on their own connections, so that's 500K games \* 2 = 1M concurrent connections, plus the compute to validate every move and run two clocks per game. These numbers carry through the deep dives.

With that in mind, here are the non-functional requirements:

**Core Requirements**

1. Low-latency move propagation, under 200ms end to end. In bullet and blitz games players have seconds per move, so a move has to land on the opponent's board almost instantly or the game feels broken.
2. Consistency over availability for game state. If a game server can't be reached, the game should pause rather than let two clients drift into different board positions, since a paused game can be recovered and a corrupted one can't.
3. Scale to handle 500K concurrent games (1M connections) at peak.

**Below the line (out of scope)**

1. Account security and abuse prevention beyond fair-play.
2. GDPR and data privacy compliance.
3. Monitoring, logging, and alerting.
4. CI/CD and zero-downtime deploys.

Here is how it might look on your whiteboard:

!

Non-Functional Requirements

## The Set Up

### Planning the Approach

We'll build this the way you'd want to in a real interview, going one functional requirement at a time, in the order a player hits them. First we match two players into a game, then we play that game in real time with the server owning the board and the clocks. Finally we rank players on the leaderboard once their games end.

The real-time game is the heart of the system and where the game server comes in, so it gets the most attention. Once the three requirements work end to end, the non-functional requirements (scale, low latency, and a fair clock) are what we dig into in the deep dives.

### [Defining the Core Entities](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery#core-entities-2-minutes)

We'll start with a short list of the nouns we'll need for the api design and storage model. We don't need columns yet, just enough vocabulary to talk about the API and the design.

1. **Player**: A registered user, with their identity and skill rating (ELO). The rating is what drives both matchmaking and where they land on the leaderboard.
2. **Game**: A single chess game between two players. It tracks who's playing which color, the current board position, whose turn it is, the clock state, and the result once it's over.
3. **Move**: One move in a game (from square, to square, move number, timestamp). The moves form the append-only history of a game, which we need for replay and for resolving disputes.
4. **MatchRequest**: A player's request to be matched, with their rating and preferred time control. Time control is how much time each side gets on the clock, like 3 minutes each plus 2 seconds added per move, and players only want to be matched against someone who picked the same one. It's an obvious noun in the design, and keeping it separate from the Game gives matchmaking something to hang off of.

ELO is just a single number that rises when you win and falls when you lose, by more when you beat a stronger player. That, and the specifics of chess time controls, aren't required knowledge for an interview. Your interviewer will either explain them to you or skip them entirely. We include them here for accuracy, but don't get hung up on the game specifics.

On the whiteboard, you can just jot down the entities like this:

!

Core Entities

### [API or System Interface](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery#api-or-system-interface-5-minutes)

We have two very different kinds of interaction here. Matchmaking and the leaderboard are ordinary request/response, so they make sense as REST calls. Gameplay is a continuous back-and-forth between two players and the server, so it rides over a WebSocket. We'll design the REST surface first and then describe the messages that flow over the socket.

To request a match, a player tells us their preferred time control. We use POST because we're creating a new MatchRequest the system will work on asynchronously.

```
POST /matchmaking -> MatchRequest
Body: {
  timeControl    // e.g. "blitz-3-2" = 3 min each, +2s per move
}

- the playerId comes from the auth token, never the body or query params
```

Notice the playerId isn't in the body. A player's identity always comes from their session or JWT, never from data the client sends. I see candidates pass userId or, worse, their own rating in the request body all the time, and it's a red flag. Anything the client could lie about to get an easier opponent has to come from the server. The rating gets read from the Player record, not trusted from the request.

Gameplay happens over a WebSocket scoped to a single game. Once a game exists, both players connect and exchange messages. There's no REST verb here, so we describe the protocol instead, the messages the client sends and the ones the server pushes back.

```
WS /games/:gameId

Client -> Server:
  sendMove   { from, to, moveNumber }

Server -> Client:
  moveAck       { accepted, reason?, whiteTimeMs, blackTimeMs }
  opponentMove  { from, to, whiteTimeMs, blackTimeMs }
  gameEnd       { result }
```

There is no unified standard shorthand for WebSocket messages. The exact naming and structure of the endpoints can vary. I chose to represent it this way, but anything that is clear to you and your interviewer is fine.

Finally, the leaderboard is a read. We page through players sorted by rating, and a player also wants their own rank, so that's two GETs.

```
GET /leaderboard?cursor={cursor}&limit={limit} -> Player[]
GET /players/:playerId/rank -> { rank, rating }
```

## High-Level Design

### 1) Players should be able to find an opponent through skill-based matchmaking and start a game

We start where the player does. They want a game, so first we pair them with someone close in skill and create the Game the two of them will play.

!

Matchmaking

We add one service and one table:

1. **Matchmaking Service**: Takes match requests, finds two compatible players, and creates the Game record that the gameplay path picks up.
2. **MatchRequest table**: Holds pending requests with each player's rating and chosen time control.

The naive flow:

1. The player's client sends a POST to the Matchmaking Service with their time control.
2. The service creates a MatchRequest with the player's rating (looked up server-side) and a status of pending.
3. It queries for another pending request with the same time control and a rating within some range, say plus or minus 200.
4. If it finds one, it creates a Game with both players, marks both requests matched, and returns the gameId to each so they open the gameplay WebSocket. The thing to notice is that the matchmaking POST is a long-poll. It doesn't return the instant the request is created, it stays held open until the player is actually paired (or the wait times out). So the player who triggers the match and the player who was already sitting in the pool both get their answer on the same held request.
5. If there's no one to pair with yet, the request stays pending with its long-poll still held. When a compatible player shows up later and gets paired with it, that held request is exactly what completes. The waiting player learns they've been picked up the moment it happens, no separate notification channel required.

We can set some time limit, so that if a match is not available within, say, 30 seconds, we widen the rating range and try again. Eventually we expire the request and tell the player to try later rather than leave them waiting indefinitely.

This is easy enough for a quiet platform. But at peak we're pairing players out of a pool of hundreds of thousands, and step 3 is a query against a shared table on every single request. There's a race lurking right in that step too. Two matchers can read the same pending player at the same instant and both pair them off, double-booking that player into two games at once. So the table won't hold up, the claim needs to be made safe against that race, and players at the rating extremes will wait forever for a peer. We'll explore all of these problems later on in our matchmaking deep dive.

### 2) Players should be able to play a game in real time

Matchmaking just paired two players and created the Game. Now we need the path for them to actually play it, with the server as the single source of truth for the board and the clocks.

!

Real-Time Gameplay

We need to add a new server, the Game Service, to own that authoritative state. It validates incoming moves, manages the two clocks, and pushes validated moves to the opponent.

Each live game sits in the memory of the server running it. The board, whose turn it is, and both clocks are all in process, so validating a move is a local operation with nothing to fetch. We still append every move to a durable log, but that write is there for recovery rather than for serving the next move. Holding games in memory does mean that both players have to land on the same server and that a crash takes its in-flight games with it. Those are the problems the game-server deep dive picks up.

Here's how a move flows once both players are connected:

1. When the game is created, each player's client opens a WebSocket to the Game Service holding their game in memory, and the service associates that connection with the player's seat in the game.
2. The player drags a piece and their client sends a sendMove message over the WebSocket with the from and to squares.
3. The Game Service receives it and validates against the in-memory board, checking that it's a legal chess move and that it's actually this player's turn.
4. If it's legal, the service updates the in-memory board, stops the moving player's clock, and starts the opponent's.
5. The service appends the move to the durable move log so the game can be recovered after a crash.
6. It pushes an opponentMove to the other player and a moveAck back to the mover, each carrying the authoritative clock times so both sides stay in sync. An illegal move gets a rejecting moveAck and nothing changes.
7. When the game ends by checkmate, stalemate or another draw, or flag (running out of time), the service writes the result and sends gameEnd to both players. Checkmate and the automatic draws fall out of the same move validation that already owns the rules.

The in-memory board is the live source of truth. The database is really a recovery log sitting off the hot path that can be used at any time to rebuild the current state of the board.

Notice that step 5 comes before step 6. We persist a move before we broadcast it. If we acked the mover or pushed to the opponent first and then crashed, recovery would come back to a board missing a move both players already saw. That's exactly the corrupted state we said we'd rather pause than allow. We can persist synchronously like this because the 200ms budget easily absorbs a few-millisecond write, so correctness is basically free here.

###### Pattern: Real-time Updates

Pushing each validated move to the opponent the instant it's accepted is a textbook realtime-updates problem. Our pattern breakdown walks through why a persistent WebSocket beats polling or SSE when both sides send and receive continuously, which is exactly the shape of a chess game.

[Learn This Pattern](https://www.hellointerview.com/learn/system-design/patterns/realtime-updates)

### 3) Players should be able to view a global leaderboard and see their own rank

The last requirement is the global ranking, updated shortly after games end.

!

Leaderboard

There's no new service here, just two flows hanging off what we already have:

1. When a game ends, the Game Service computes the new ELO (the fancy chess rating) for both players from the result and each player's rating as of the start of the game. Those start-of-game ratings are snapshotted on the Game, since that's what the ELO delta is computed from. The service then updates each player's rating on the Players table.
2. The leaderboard endpoint reads the Players table sorted by rating descending, with cursor pagination and an index on the rating column. A player's own rank is a count of how many players sit above their rating.

Because ratings only change when a game ends, the leaderboard is naturally fresh without anything fancy. And the top page is very cheap to load. With a btree index on rating, ORDER BY rating DESC LIMIT 50 just walks the first fifty index entries and stops, so even 10M players sort fast in Postgres. Don't let the row count scare you.

Where it falls apart is a player's own rank. SELECT COUNT(\*) FROM players WHERE rating > :myRating has to count every row above you. A plain btree gives you sorted order but not a position, so there's no O(log n) shortcut to "you're 4,201,930th."

That count is O(rank), it's slowest for the mid-pack players who make up most of the requests, and it's one of the most-viewed reads on the site. We'll talk about options to speed this up in our deep dives.

That gets us a working system. Players match, play a validated real-time game, and climb a leaderboard. Now the bottlenecks. Let's tackle them.

## [Potential Deep Dives](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery#deep-dives-10-minutes)

How much you should drive these is a function of seniority. A mid-level candidate can lean on the interviewer to steer toward the interesting problems. A senior or staff candidate is expected to look around corners and name these bottlenecks before they're asked.

### 1) How do we match players fairly at scale?

At peak we said we have 500K concurrent games which is 1M players in active games at any given time. Most chess is played at fast time controls, where a bullet or blitz game lasts a couple of minutes, and players usually re-queue as soon as a game ends. So roughly 1M players each starting a fresh match request every ~120 seconds is 1M / 120 ≈ 8k new match requests per second from the actively-playing population alone. Add players arriving fresh plus evening and tournament peaks and it's into the tens of thousands per second.

At that rate, scanning a table on every request stops holding up, because a match isn't a point lookup. It's a range search for the nearest compatible rating in the same time control, followed by a read-modify-write to claim that opponent before another matcher grabs them.

Claiming the opponent is the harder half, because the ratings follow a bell curve. So the vast majority of players sit in the meat of the curve, and at any given moment the same waiting players are a compatible match for nearly every incoming request. Every worker that reaches for one is fighting all the others over the same small set of rows.

Players out in the tails have the opposite problem, since a score like 2700 (really good!) might only have three or four peers online at any given time. Their search range has to widen a long way before it contains anybody at all. By the time it does we're handing them a game against someone 500 points weaker, which isn't really a game.

###### Pattern: Dealing with Contention

Two matchmaking workers can spot the same waiting player at the same instant and both try to pair them, which would double-book that player into two games. That's a contention problem, and our dealing-with-contention pattern covers the atomic claim techniques that make sure exactly one worker wins.

[Learn This Pattern](https://www.hellointerview.com/learn/system-design/patterns/dealing-with-contention)

### 

###### Approach

Pull the pending players out of the database and into a sorted structure (by rating, one per time control) held in the matchmaker process's own memory. A new request binary-searches a window around its rating and pairs with the nearest waiting player. Because it all lives in one process, the match is a local read-modify-write with no network hop and no race. You'd just need to make sure you handle multi-threaded concurrency, which is easy enough.

###### Challenges

It only works as a single process. The moment we run a second matchmaker for throughput (which we'll need at this scale) or for failover, the two have different ideas about who's waiting. They start double-booking players or missing matches.

The entire pending pool also lives in that one process's heap, so a crash or a routine deploy drops everyone currently queued. It's a useful picture of what we want the data structure to do, but we can't run the real thing on one box.

### 

###### Approach

An alternative is to leave the pending requests in the database and let the matchmakers claim them there, but with a SKIP LOCKED. A matcher queries for compatible requests inside its rating window, ordered by how close they sit to its own rating, and takes the first row it gets back.

That top row is where a plain SELECT ... FOR UPDATE falls down. Every worker hunting for a 1500-ish opponent computes the same closest match, and they all queue up behind whichever one locked it first. Meanwhile the meat of the bell curve is packed with players a point or two further out who'd give just as good a game.

SELECT ... FOR UPDATE SKIP LOCKED hands each worker the closest row nobody else has locked rather than blocking on one that's already taken, so the worker that loses the 1500 picks up the 1501 and carries on. From there the matcher marks both requests matched and inserts the Game, all inside one transaction.

The main appeal in this approach is that the claim and the game creation commit together. There's never a moment where we've pulled two players out of the pool but haven't yet recorded the game they belong to.

###### Challenges

Every match updates two request rows, and an update in Postgres leaves the old version of the row behind as a dead tuple. At tens of thousands of requests a second we're producing dead tuples faster than autovacuum can clear them, on a table that every incoming request is also range-scanning.

The table and its indexes bloat, the scans get slower, and the slower scans hold their locks longer, which is what people mean when they tell you not to build a queue on your database. We can't spread that load over more primaries either, because a pool split across two of them can never pair a player on one with a player on the other.

Skipping a locked row is close to free in the middle of the curve, where there's always somebody a point or two away to take instead. It stops being free once we get out to the tails. A 2700 whose one available peer is locked doesn't get handed a near-equivalent, they get someone hundreds of points off or nothing at all, and those are already the players waiting longest.

### 

###### Approach

Moving the pool out of the database and into a shared store keeps the always-sorted structure the in-process version had. It gives every matchmaker the same copy of the pool, and costs no WAL write or dead tuple per claim. Any store the workers can all reach would work here, as long as it can hand a waiting request to exactly one of them.

We'll use [Redis](https://www.hellointerview.com/learn/system-design/deep-dives/redis) because its sorted sets give us the ordered lookup for free. A sorted set keeps its members in full sorted order by score (it's backed by a skip list, so it behaves like an always-sorted index). That makes inserts, removals, and range-by-score lookups all O(log n) plus however many members come back.

We keep one sorted set per time control, so there's one copy of the pending pool and any matchmaker can search and claim against it. The member is the requestId and the score is the rating, and the request's other fields live in a hash.

```
# the request's other fields live in a hash, written first so
# whoever claims it can read the player
HSET mmreq:req_8a3f \
  playerId 42 rating 1512 status pending enqueuedAt 1718900000
# now it's discoverable, scored by rating
ZADD mm:blitz 1512 req_8a3f
```

Every request does two things, finding a compatible opponent and then claiming that opponent before another worker grabs them.

**Finding an opponent.** A worker searches a rating window around the incoming request with a range-by-score lookup, which is the sorted-set operation we came to Redis for. That handles the middle of the pool, but for the 2700 with almost no peers online we widen the window as the request waits. The range a request will accept grows the longer it has sat, computed from the enqueuedAt we stored. A strong player looks for near-peers first and opens up from there, with a light background pass re-scanning the waiters to apply the widened window.

```
# base search, opponents within +/-50 rating
ZRANGEBYSCORE mm:blitz 1462 1562
# widen with wait time: 50 + 8*30 = 290 after 30s, so 1512 +/- 290
ZRANGEBYSCORE mm:blitz 1222 1802
```

**Claiming the opponent.** Finding a candidate isn't enough, because thousands of workers scan the same hot pool and several can land on the same waiting player at once. The claim has to be atomic, and ZREM gives us that for free since it returns the number of members it actually removed. A worker that gets 1 pulled that player out, while a worker that gets 0 knows somebody beat it there.

```
# claim atomically: 1 -> won the player, 0 -> already taken
ZREM mm:blitz req_2c91
```

That covers two workers reaching for the same player, but not two workers who each claim the other's player at the same moment. Say Ava at 1508 and Ben at 1515 queue at the same moment and land on different workers, so Ava's worker finds Ben and removes him while Ben's worker finds Ava and removes her.

Both ZREMs return 1, both workers think they won, and both create a game. That leaves Ava and Ben each holding a different gameId and each sitting alone waiting for an opponent who's in the other game.

Nobody claimed the same player twice, but we still managed to double-book both of them. Searching before you add yourself doesn't save you either, it just means two players who arrive together both find an empty pool and both sit down.

The search and the claim are separate commands, so another worker always gets to run in between them. Since Redis executes a Lua script start to finish on its single thread with nothing else interleaved, we can hand it the whole decision instead.

```
-- KEYS[1] = mm:blitz   ARGV = requestId, rating, window
local rating, window = tonumber(ARGV[2]), tonumber(ARGV[3])

if redis.call('ZREM', KEYS[1], ARGV[1]) == 0 then
  return { 'claimed' }            -- another worker already took us
end

local found = redis.call('ZRANGEBYSCORE', KEYS[1],
                         rating - window, rating + window, 'LIMIT', 0, 1)

if found[1] then
  redis.call('ZREM', KEYS[1], found[1])
  return { 'matched', found[1] }
end

redis.call('ZADD', KEYS[1], rating, ARGV[1])
return { 'waiting' }
```

A request goes into the pool when it arrives, and every attempt to match it, the first one and every widened retry, is one call to this script.

Pulling the caller out first is what stops it matching itself, and checking that removal is what stops a widened retry from finding a second opponent for a player another worker just claimed. Every call comes back matched, waiting, or claimed, and nothing can interleave to produce a different answer.

!

Redis

###### Challenges

The widening policy (the starting window, how fast it grows, where it caps) is a knob you tune against real wait-time data. And the 2800s at 3am still wait longest no matter what we do here, since there's nobody online for them to play.

The script also runs on the one thread Redis has, so every other client waits behind it. Ours is a few sorted-set operations and finishes in microseconds, but that's the reason to keep it short instead of looping over a big candidate list inside it.

We'll go with the Redis sorted set. Two follow-ups are worth expecting.

#### Do we need to shard the pool across Redis nodes?

Probably not, and it's worth running the numbers before you reach for it. The usual answer to "scale matchmaking" is sharded queues, splitting pending players across many rating-band keys so no single key runs hot. At a peak of ~30k requests per second and roughly 4 Redis ops each, that's ~120k ops per second in total. The busiest single time control is maybe 40% of that, so about 50k ops per second on its key.

A single-threaded Redis node serves sorted-set ops in the low hundreds of thousands per second, so our hottest key sits under a third of one node with 4-5x headroom. The pool itself is small, a few tens of thousands of entries, comfortably under 100MB.

Sharding it would buy us more moving parts and a new class of bug at the band edges. Two players 10 points apart could land in different buckets and never see each other. We'd only want it if one time control grew several times past today's peak.

#### What happens if that Redis node goes down?

It's a single point of failure for the pending pool, so we run Redis replicated with automatic failover (Redis Sentinel, or a managed Redis Cluster) and promote a replica if the primary dies. We get off easy here because a pending match request isn't worth much. If a failover drops the in-flight pool, the clients waiting on it just re-submit and the queue refills within seconds. Losing an in-progress game would be a real problem, which is why we go to much more trouble for the game servers.

### 2) How do we scale the game servers to 500K concurrent games?

Each active game holds two persistent WebSocket connections plus the live state behind them, the board, whose turn it is, and both clocks. At 500K games that's 1M connections and 500K little sessions to keep track of. A single server can hold tens of thousands of idle WebSocket connections (even more on really large hardware), but in any case, we need to scale our cluster of servers into the hundreds.

There are two ways to run this fleet, and they differ in what a node owns. If a game lives in one server's memory the way the high-level design has it, both players have to land on that server. A crash also takes its games with it, so we need placement and recovery. If the game lives in a shared store instead, nothing needs placing, and the work moves to keeping that store correct under concurrent moves and getting each move to the right socket.

### 

###### Approach

Run a fleet and deterministically route both players in a game to the same server, for example by hashing the game ID to a server. Both players land together, so move validation and clock updates stay local and fast, which keeps us under the 200ms budget.

###### Challenges

A plain hash means that when a server is added or removed, a large fraction of games get remapped to a different server. And we still haven't solved durability. When one server dies, every game on it is lost, because its state lived only in that process's memory. Load can also skew if the hash happens to pile heavy games onto one node.

### 

###### Approach

There are two pieces here, routing reliably and surviving a crash.

For routing, a thin stateless session router sits in front of the fleet. On a new game it maps the gameId to a server with [consistent hashing](https://www.hellointerview.com/learn/system-design/deep-dives/consistent-hashing) and sends both players there, so move validation and clock updates stay local. Membership comes from a registry like [ZooKeeper](https://zookeeper.apache.org/), etcd, or Consul, where each game server registers an ephemeral node (a registry entry that auto-deletes if the server stops heartbeating). The router watches the registry and rebuilds its ring whenever a node appears or expires, so the lookup is a pure function of the gameId and the current membership. Adding or removing a server only remaps a small slice of games, and the ephemeral nodes mean a dead server drops out of the ring on its own.

For survival, notice that we already have everything we need from the high-level design. Every move is appended to the durable Moves log before it's broadcast, and the Game row carries the clocks, whose turn it is, and the result. So recovery isn't a new mechanism, it's just replay. A replacement server loads the game's row for the clocks and turn, then replays its moves to rebuild the board in memory. A whole 40-move game is only a few hundred bytes of moves, so that replay is microseconds, and we never store the board position separately or reason about snapshot freshness.

The one thing failover does need, and the easy thing to miss, is a fence. A server that gets replaced but is still alive, say on the far side of a network partition, must not keep writing to a game the ring has already moved on from. We add a generation counter to the Game row for exactly this:

```
CREATE TABLE games (
  game_id     UUID PRIMARY KEY,
  white_ms    INTEGER,
  black_ms    INTEGER,
  turn        CHAR(1),      -- 'w' or 'b'
  generation  INTEGER,      -- bumped each time the ring reassigns the game
  updated_at  TIMESTAMPTZ
);
```

Each time the ring reassigns a game, its new owner bumps the generation. Every write for that game, the move append and the clock update together, runs in one transaction guarded on it:

```
UPDATE games
SET white_ms = :white_ms, black_ms = :black_ms, turn = :turn,
    generation = :gen, updated_at = NOW()
WHERE game_id = :id AND generation <= :gen;
```

A zombie server still holding the old generation fails that predicate, so its writes, including any move it tries to append in the same transaction, are silently dropped. It can't reanimate a game the ring already moved.

!

Game Server Routing

Putting it together, here's the full path when a server holding game G dies:

1. Server S owns game G at generation N and crashes, so its ephemeral registry node stops heartbeating and expires.
2. The router rebuilds the ring without S and the successor of hash(G) is now server S'.
3. The clients detect the dropped socket and reconnect, and the router sends them to S'.
4. S' loads G's row and replays its moves to rebuild the board, reads generation N, and bumps it to N+1 as the new owner.
5. A delayed write from the partitioned-but-alive S lands at generation N, fails the generation <= :gen check against N+1, and is rejected.

###### Challenges

That reconnect is a visible blip, though pausing the clock during it (our consistency-over-availability choice) keeps it fair. The fencing in step 5 is the real consistency-over-availability work, and the easy thing to skip. Without it, a partitioned-but-alive server would keep mutating a game the ring already moved on from.

Keep player disconnects separate from server failure, because the clock rule flips. When a player drops their own connection, the clock keeps running, maybe with a short grace window. If you don't reconnect in time you flag, just like over the board. Pausing on every disconnect would let someone escape a losing position by closing the tab. Recovery otherwise is just a row read plus replaying a few hundred bytes of moves, so it's effectively instant.

One wart is inherent to hashing. Because placement is a pure function of the ring, scaling the fleet up during an evening peak remaps a slice of perfectly healthy in-progress games onto the new node. The only time you actually want to move a game is when its own server dies.

For chess that's a small price, a brief reconnect on a fraction of games during scale-up. Neither a coordinator-owned placement directory nor the shared-store design below pays this cost, since neither moves a healthy game when the fleet changes size.

### 

###### Approach

The other option is to stop having servers own games at all. The live board, whose turn it is, and both clocks sit in Redis under the gameId, and every accepted move still gets appended to the same durable Moves log we were writing before. A move can then be handled by whichever node happens to be holding that player's socket, and the two players never have to land together.

When a move arrives, the node reads the position, validates it, and commits with a compare-and-set on a version that increments each move. Two moves landing within a millisecond of each other can't both win. The second one finds the version it read has already moved on and revalidates against the new position, which is the ordering the single owning process gave us for free.

The commit stamps the clocks off Redis's own clock rather than the node's, since the next move may be handled somewhere else entirely and a local monotonic reading means nothing over there.

Once the move commits, the node publishes it on a channel keyed by the gameId, and the node holding the opponent's socket is subscribed and pushes it down. Redis pub/sub is fire-and-forget with no replay, so a reconnecting client doesn't ask the channel for what it missed. It resubscribes and reads the moves after its last sequence number out of the durable log. There's no ring to rebuild and no membership registry, because a node that dies was only ever holding sockets.

###### Challenges

Redis is now on the path of every move in every live game, so Redis is what you keep available and scaled. Ordinary Redis replication is asynchronous and a failover can drop recently acknowledged writes, so the durable move append stays in the design. Blast radius depends on how you deploy it. A single primary means a failover stalls every game at once, while partitioning state and pub/sub by gameId limits it to the games on that shard.

You trade consistent hashing and a membership registry for a pub/sub layer. Each node still needs to know which of its own sockets belong to which game, so it can route what arrives on a channel.

Both of these work, and we'll stay with the stateful fleet. The board sits in the memory of the server validating the moves, so every read the rules need is local. The move log we already keep for replay and disputes covers recovery without a second mechanism. The only thing we're really adding is placement.

The Redis design is a good answer too, and if you take it in an interview the things to have ready are the versioned commit and where the clocks read their time from. You'd prefer it when the game logic and the connection tier need to scale independently, or when you'd rather operate one shared store than a fleet with placement rules.

Lichess splits the difference. Live games run as per-game actors in the backend, which is the stateful shape. But WebSocket connections are handled by an entirely separate service that talks to that backend over Redis, which looks a lot like the pub/sub path above.

**Wouldn't a framework just do the placement for you?** If you go stateful, often yes. Stateful sharding frameworks and virtual-actor runtimes make placement a directory a coordinator owns instead of a hash every router recomputes. Adding capacity then picks up only new games, and no healthy game moves on a membership change.

Akka Cluster Sharding and Microsoft Orleans both work this way, addressing an actor per gameId. For heavier process-per-match games like shooters, managed allocation (Agones, AWS GameLift) hands you a whole server per match.

Be honest about what this changes for chess, though, which is nothing about the answer. You still recover by replaying the move log, and you still want the fencing that Orleans provides with its strongly-consistent grain directory and that our generation guard does by hand. The hand-rolled consistent-hash router is fine here. You'd reach for a framework only if you were already building on one.

### 3) How do we keep the clock fair despite uneven latency?

The server owns the clock, so it can only start and stop a player's timer when their move actually arrives over the network. That means each player's network latency comes out of their own clock, and players don't have equal latency.

Say Player A has a 30ms round trip to the server while Player B, much further away, has 200ms. B can't start thinking until A's move has crossed the network to reach them, and B's reply spends that same trip coming back. Both legs land on B's clock, so every move costs them about 170ms more than it costs A.

Over 40 moves in a 3-minute blitz game that's nearly 7 seconds of B's clock spent purely in transit, which is plenty to lose on time. Players on mobile or far from the server are at a real disadvantage through no fault of their play. How do we make the clock fair?

### 

###### Approach

Let the client run the clock. Each client tracks its own remaining time and, with every move, tells the server the timestamp it played at (or how much time it used). The server just records whatever the client reports. Since the client measures its own think time locally, network transit never touches the clock, which neatly sidesteps the fairness problem above.

###### Challenges

A modified client just lies and says it never runs low. Even with honest clients, the two timers drift apart and disagree about whose time ran out first. The clock is exactly the kind of authoritative value that can never live on the client.

### 

###### Approach

The server owns each player's remaining time. When a move arrives, it stops the mover's clock and starts the opponent's. Clients show a local timer for smoothness, but the server's numbers are the official ones.

This is what our high-level design currently does.

###### Challenges

This fixes cheating but not fairness. The server starts deducting the moment the previous move arrives and stops when the next one arrives, so the whole network round trip comes out of the moving player's budget. The player on a 200ms round trip keeps paying that 170ms tax every move, which is a real, systematic disadvantage baked right into the design.

### 

###### Approach

Keep the server authoritative, then credit back the network transit so high-latency players aren't punished for their distance. We don't run a timer per game. The server stores each player's remaining\_ms and the last\_start\_timestamp of when their clock started, reads from a monotonic clock, and subtracts elapsed time on demand. The only writes happen on a move.

The actual work is compensating for latency. The server continuously measures round-trip time to each client with WebSocket ping/pong frames, independent of moves since a player might think for 30 seconds between them. It keeps a rolling median rather than a mean, so one bad spike doesn't skew it. What it credits back is the full median\_rtt, not half of it, because both legs of that trip are dead time for the player. They couldn't move before the position reached them, and their move was already made by the time it landed back at the server. Charging either leg to their clock charges them for the network.

Run the 200ms player through it. Uncompensated they pay a 170ms penalty on every move, close to 7 seconds across a 40-move blitz game. Crediting their measured round trip hands that whole 200ms of transit back and leaves them paying nothing but think time. The cap below limits any single move to about 100ms though, so in practice the gap narrows to under 3 seconds rather than disappearing.

Compensation only takes you so far. The other half of the answer is running game servers in the regions your players actually live in, so the round trip is small before you ever start crediting it back.

###### Challenges

The compensation is still an estimate. RTT is noisy and network paths can be asymmetric, so crediting the measured round trip isn't perfect on any single move, though it's fair on average.

There's also an abuse angle, and it's worth being honest about it. Because we credit time off measured RTT, a client can inflate its own RTT by deliberately dragging out its pong responses. The server can't tell a stalled pong from a slow link. Server-side timestamps don't save us here, the client isn't forging anything, it's just answering slowly.

So the real defense isn't perfect detection, it's a cap. We limit how much any single move can claw back (a ceiling around 100ms), which means even a client gaming its RTT can't turn a slow connection into meaningful free time.

Compensation stays best-effort by design, and that's fine, the goal is leveling a systematic geographic disadvantage, not defeating a determined cheater at the margin. Beyond that the estimator needs tuning, and the client's local display can briefly disagree with the authoritative server time, which you smooth over in the UI rather than the protocol.

### 4) How do we keep the leaderboard correct and fast at 10M players?

Back in the high-level design we flagged two things to come back to here. Computing a single player's rank out of 10M, and making sure a finished game's rating change reliably lands. We'll start with the rank, since that's the part with a more substantive design challenge. The reliability of the write is mostly mechanical, so we'll close on it.

The reads split into two very different queries, nowhere near equally hard. The top-N page we already put to bed in the high-level design, a btree on rating makes ORDER BY rating DESC LIMIT 50 cheap and a cache on a page that barely moves seals it. The one that actually causes us issues is fetching a single player's rank. "Where do I sit out of 10M" is COUNT(\*) WHERE rating > :myRating, and a btree can't answer that in better than O(rank). It has to count every entry above you. For a mid-pack player that's millions of index entries per call, and it's the most common personalized read on the page. So the real challenge here is how you compute rank, not how you sort the table.

### 

###### Approach

Most products don't actually need your rank exact to the person. Keep a count of players per rating band, say 10-point buckets, a few hundred of them across the whole rating range. Update it on each game end, moving a player from their old band to their new one. A player's rank is then the summed counts of all higher bands, optionally interpolated within their own band.

###### Challenges

The whole structure is a few hundred integers, so a rank lookup is constant work and cheap to keep current. The cost is that the answer is approximate, "about 4,200th" rather than exact, and you have to keep the band counts in step with the real ratings. For a lot of leaderboards that's a perfectly good trade, and it's worth naming as the pragmatic middle option rather than jumping straight to a new datastore.

### 

###### Approach

When you do want exact rank cheaply, keep the ranking in a [Redis](https://www.hellointerview.com/learn/system-design/deep-dives/redis) sorted set, with the member as the playerId and the score as the rating. ZREVRANK player gives an exact rank and ZREVRANGE 0 49 the top page, both O(log n). The skiplist behind a sorted set is effectively the order-statistics structure a plain btree isn't.

Since we already run Redis for matchmaking, this is a natural addition rather than a new piece of infrastructure.

The set is updated as games finish, and it's a derived view, never the source of truth (how the rating write keeps it in step with Postgres is the last thing we'll cover). We keep Redis durable with AOF, but a lost or drifted set just gets rebuilt. The scale is comfortable for a single instance. 10M members run on the order of a gigabyte. The write rate is just the game-end rate, roughly 4k games finishing per second times two players, so about 8k ZADDs per second, which Redis handles easily. A global ranking wants one sorted structure anyway, so there's nothing to shard.

!

Redis Sorted Set

###### Challenges

Equal ratings need a deterministic tiebreak baked into the score (rating plus a fractional last-updated term, say) or pagination can wobble. And the honest question to ask out loud is whether you need exact rank at all. If approximate is fine, the bucketed counts are simpler and cheaper, and the sorted set is the answer specifically when exactness matters.

That leaves landing the rating change durably. When a game ends we already record its result on the Game row durably, as part of finalizing the game. A player's ELO is just a function of their completed games (each game stores the pre-game ratings, so its delta is self-contained), so it's always derivable from that record. There's no precious in-memory rating that can be lost.

For fast reads we keep that rating materialized in two places, on the Players row and in the sorted set, both updated when the game ends. What keeps them from drifting is that neither is a second source of truth. They're both derived from the Game result, and the propagation is idempotent.

The game-end result write to the Game row is the one commit point. An apply step then fans the ELO delta into the Players row and the sorted set, keyed on the gameId so replaying the same game is a no-op. A retry after a half-finished update corrects rather than double-counts.

If a write is missed or Redis drifts anyway, a periodic reconciliation recomputes from the completed games and overwrites both, and in the worst case we rebuild the whole set from scratch. That's why a crash right at game end isn't scary. The result is durable, and the leaderboard is just a view over it.

The leaderboard is where candidates tend to over-build or under-build. Senior+ engineers should see that a rating is a derived total over finished games, not a precious in-memory value. Both the crash-durability worry and the rebuild story then fall out for free. The Redis sorted set is just an external index over that record, the right structure for O(log n) rank.

### Final Design

Putting it all together, our final design looks like this:

!

Final Design

### Some additional deep dives you might consider

We couldn't fit everything. A few more directions an interviewer might push on:

1. **Fair play and anti-cheat**: Engine assistance is the existential threat to online chess, and a player feeding the live position to an engine is nearly undetectable from any single game. Catching it is an offline ML and behavioral-analysis problem, comparing move choices against engine top-picks, watching move-time patterns, and scoring accuracy against rating history, then flagging accounts for review. It's a different system from the real-time path we built, which is why it's below the line. But naming it (along with tournament integrity) shows you understand what really makes or breaks one of these platforms.
2. **Spectating popular games**: A top game, a super-GM blitz match, can draw tens of thousands of watchers, which is a read fan-out problem with nothing in common with the 1:1 gameplay path. You wouldn't hang spectators off the authoritative game server. You'd fan validated moves out through a pub/sub layer, or a CDN-style tree, to read-only subscribers, where a few hundred milliseconds of lag is fine because spectators never write.
3. **Storing and serving the game archive**: Every finished game is kept forever (Lichess sits on more than 12 billion), which is a data-at-rest problem separate from the live path. It powers post-game analysis and the opening explorer, the "what do players usually play in this position" feature. This is easier than it first looks, because a game is just its move sequence stored as a string. Finding every game that followed a given line is a prefix range scan over those sequences rather than anything fancy. Richer queries across the whole archive, aggregating by position including transpositions, are where you'd reach for a columnar or search store (Lichess indexes games in Elasticsearch). None of it belongs on the OLTP database the live game runs on.
4. **Premoves in bullet**: In bullet and ultrabullet, players queue a move to fire the instant the opponent moves, and strong players stack several in a row. What makes it interesting is the server logic. The server validates and applies a move the player committed before they'd seen the opponent's actual reply, and discards it cleanly when the reply makes it illegal. All of that happens the moment the opponent's move lands, so the queued move costs effectively no clock. Real platforms have iterated on these edge cases for years.

## [What is Expected at Each Level?](https://www.hellointerview.com/blog/the-system-design-interview-what-is-expected-at-each-level)

We've gone deeper here than any single interview will. The useful question is what's actually expected of you, and that depends on the level you're interviewing at.

### Mid-level

For this question, I expect a working high-level design that covers all three core requirements, matchmaking, a server-validated real-time game over a WebSocket, and a leaderboard. You need to land on the server, not the client, owning move validation and the clock. I want to see you notice that 500K concurrent games can't live on one box. I don't mind at all if the first thing you reach for is hashing the game ID straight to a server. Just be able to tell me what happens to those games when that server dies. Reaching a server-authoritative clock with some prompting is the other thing I'd expect here.

### Senior

For senior, I want you to speed through the high-level design so we can spend our time on the deep dives. Those are matchmaking at scale, scaling the game-server fleet, clock fairness, and keeping the leaderboard correct and fast. The first three carry the most signal, so I'd want at least two of those covered well.

You should be able to derive the scale yourself (1M connections from 500K games, tens of thousands of match requests per second) and use those numbers to argue why the naive approaches fall over. I'm looking for you to articulate the specific tradeoff in clock design between a plain server-authoritative clock and one that credits the round trip back.

On the game servers I don't need a particular answer. Either holding games in memory or keeping them in a shared store is fine by me, but I do want you to know what your choice costs. If you keep the board in memory, tell me how both players find the same server and what happens when it dies. If you put it in Redis, tell me what stops two moves interleaving and how a move reaches the opponent's socket.

Choosing to pause a game rather than risk two clients drifting into different positions is the kind of consistency-over-availability call I want made out loud.

### Staff+

For a staff+ candidate, I'm looking for depth and judgment past the textbook answers. On the game servers I want you to see that the durable move log we're already writing is the recovery mechanism, whichever design you picked. A replacement server replays a few hundred bytes of moves and it's back. Candidates who add a checkpoint scheme or a snapshot table on top of that usually haven't worked out what it would buy them, which at a few hundred moves a game is nothing.

From there I'd expect the production realities we glossed over. How does a fleet drain games on a deploy? What does a reconnection look like from the client while a game is being recovered? And how does the matchmaking widening policy get tuned from real wait-time data?

###### Test Your Knowledge

Answer the question below to find your gaps.

Mark as read

[Next: ChatGPT](https://www.hellointerview.com/learn/system-design/problem-breakdowns/chatgpt)

<div class="comments-container w-full max-w-full min-w-0 overflow-x-hidden overflow-y-hidden pb-6"
