# How Figma Built Multiplayer Editing on Simplified CRDTs

> Source: [https://www.hellointerview.com/learn/system-design/in-the-wild/figma-multiplayer](https://www.hellointerview.com/learn/system-design/in-the-wild/figma-multiplayer)

---

# How Figma Built Multiplayer Editing on Simplified CRDTs

By[Evan King](https://www.linkedin.com/in/evan-king-40072280/)·Published Jul 28, 2026

![Figma](https://www.hellointerview.com/_next/static/media/figma.0ni35n1gperui.svg?dpl=496e216d3ce87e7f3171c9d940be7a9f2d93afb8)

###### Read the Source Blog

Originally published by Figma Engineering on October 16, 2019

[View](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)

## The TLDR

When Figma launched multiplayer editing in September 2016, no other design tool had live collaboration. In fact, most designers hated the idea of it, fearing "hovering art directors" and "design by committee" (funny to think about now). They carried on anyway, and three years later Evan Wallace, Figma's co-founder, published [a walkthrough of how the syncing actually works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) for others to learn from.

The system's less complex than you'd guess. To handle collaborative editing, they considered [operational transformation (OT)](https://www.hellointerview.com/learn/system-design/problem-breakdowns/google-docs#collaborative-edits-breakdown), the algorithm behind Google Docs, but decided it was overkill and would be incredibly difficult to get right for a design tool. They studied CRDTs (conflict-free replicated data types) and found that most of the complexity exists to satisfy a decentralized environment, which wasn't something they'd need so long as every edit to a document flowed through a single server. What was left after cutting both was a document modeled as a tree of objects, a single conflict rule where the last write to reach the server wins when two people [write the same property of the same object](https://www.hellointerview.com/learn/system-design/patterns/dealing-with-contention#the-race-condition), and a central server that steps in only to ensure the document remains a valid tree.

We picked this post because Figma's solution aged into the industry's answer. The design they derived from the research, a central server ordering optimistic edits with last-writer-wins per property, is what teams now buy off the shelf as a sync engine. The [original](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) is worth your time too.

## The problem

### One document, many editors

For those unfamiliar with Figma, it's a design tool that runs in the browser and is used by product teams to draw the screens and icons that become their apps. Figma's goal was to allow multiple designers to edit the same document at the same time.

The challenge is that every editor's copy of the document must converge to a single source of truth. When the edits stop, everyone has to be looking at an identical version of the document, just like with Google Docs.

Edits also have to feel instant. Nobody wants to drag a shape and wait on a central server round trip before it moves on the screen, so each client applies its own changes immediately and has to sync them afterward. This creates a short window where the two copies really do disagree, until the sync catches up.

Users also need to be able to make edits offline, which stretches that "out of sync" window from seconds to hours. A designer on a plane keeps working, then reconnects and merges back in, so the system has to absorb whole batches of stale edits.

Lastly, to add to the complexity, a Figma file is a tree. Frames hold shapes which hold text, etc, and two people restructuring it at once can do things no single-player editor could, like moving the same object into two different frames at the same time. The sync system has to figure out how to handle those moves without ever duplicating an object or losing part of the document.

## The solution

### Simplified CRDTs

At the time, the field offered two potential answers to this multiplayer problem: OT and CRDTs.

Figma ruled OT out quickly. It works by expressing every edit as an operation and transforming operations against concurrent ones, so an insert at position 5 becomes an insert at position 8 when someone else added three characters ahead of it. It's famously hard to get right. Wallace quotes Li and Li: "Due to the need to consider complicated case coverage, formal proofs are very complicated and error-prone, even for OT algorithms that only treat two characterwise primitives (insert and delete)." That warning describes the simplest possible case, plain text with two operation types, and a design document has many more than two.

CRDTs looked closer to what they needed. A CRDT solves convergence by letting each replica accept edits entirely on its own, with merges designed to give the same result no matter what order the edits happened in. The simplest example is a grow-only set, where the only operation is adding and merging two copies is just taking the union, so it can't matter whose edit came first or how long the copies were apart.

A real document needs more than add-only, though. The moment values can change, someone has to say which of two competing writes came second, and the CRDT answer is the last-writer-wins register. It holds a single value, every write carries a timestamp, and merging keeps whichever value bears the newer one. Say you and I each keep a copy of a party plan. I set the venue to the park on Monday, then you set it to the beach on Tuesday. When our copies meet, both of us end up with the beach, since Tuesday's write carries the newer timestamp. The timestamps decided the winner. But keeping track of all that metadata in a register has real cost and complexity.

The bookkeeping piles up from there. Deletes have to leave markers behind for replicas that come back late instead of actually removing anything, all of it more metadata answering the same question without anyone in charge, which write came last.

Figma, though, has exactly the thing CRDTs are designed to live without, a central server. Every edit already flows through it, so the order can simply be determined by the server, which removes the timestamps and most of the bookkeeping. The register's rule survives, the last write wins, with last now meaning last to reach the server. The team went through the rest of the CRDT literature the same way, cutting every piece a central server makes unnecessary. What survived the cutting is a document whose every property is one of these registers, minus the timestamp. A simplified CRDT.

Our [Google Docs breakdown](https://www.hellointerview.com/learn/system-design/problem-breakdowns/google-docs#collaborative-edits-breakdown) works the same OT-versus-CRDT decision from the text-editor side, with worked examples of both, and ends up picking OT.

If video's more your speed, we walk through the whole real-time collaboration space here too.

### Last writer wins on each property

Two people change the same rectangle at the same moment. Which edit wins?

Figma's tree of objects works very much like the HTML DOM. You have a single root object representing the document, whose children are the pages, and under each page sits the hierarchy of frames, shapes, and text you see in the layers panel. Each object in this tree has its own ID and a set of properties with values, which means the whole document fits in one structure:

```
Map<ObjectID, Map<Property, Value>>
```

The server keeps, for every object and property, the latest value any client has sent. If you change the color of a rectangle while a teammate resizes it, then both edits land, because they touch different properties. Change the color of the same rectangle at the same moment and there's a conflict. But it can be resolved by simply keeping whichever value reached the server last. Each property is the last-writer-wins register from earlier.

!

Figma's property value

The property value is the unit of atomicity. If a text property holds B and one client changes it to AB while another concurrently changes it to BC, the document ends up as AB or BC, never a merged ABC. For a text editor, that would be disqualifying, but it makes perfect sense for visual objects, where an edit sets a whole value like a fill color or a width. When two people recolor the same shape at the same moment, one color winning outright is the outcome you'd actually want, since there's no sensible way to merge red and blue anyway (at least not in a way aligned with what the designers meant).

That's the server's view of a conflict. The client has one of its own. Set a fill to red and the server relays a teammate's older blue, blue stomps your red on screen, then red returns once your write is acked. The flicker happens because edits apply locally before the server acknowledges them, so the client can know things the server hasn't confirmed yet. The fix is to just have the client discard incoming changes that conflict with its own unacknowledged writes.

But what about creating and deleting objects? Both are simple. Creating adds a new entry to the map, with clients minting their own object IDs, each with a unique client ID embedded so two clients never collide and creation works offline. Deleting removes the entry entirely, properties and all, since documents live for years and a file that remembered every deletion would grow forever. A property write can never create an object, and that rule is what makes deletion safe, since a stale edit aimed at a deleted ID just hits nothing and drops. And if you delete something by mistake, undo still works, because your client kept the deleted properties in its ordinary undo history and can put them back.

### The parent is just another property

Wallace called out reparenting, moving an object from one parent in the tree to another, as the most complicated part of the system. If one person changes the color of an icon while another drags it into a new frame, both changes have to survive. And if two people move the same object at the same time, the document must never end up with two copies of it.

Plenty of editors implement move as delete plus recreate, but in multiplayer that doesn't work because the recreated object carries a new ID, so a teammate's concurrent recolor targets an ID that no longer exists and vanishes with it. Figma instead stores the parent link as an ordinary property on the child. A move is just a property write, the object keeps its identity, and concurrent edits to its other properties land untouched. The representation rules out duplication too. One property holds one value, so an object with two parents can't even be expressed.

What per-property last-writer-wins can't do is keep the graph a tree. Say client 1 sets A's parent to B at the same moment client 2 sets B's parent to A. Each write is valid on its own, but together they make A and B each other's ancestors. No rule that checks one property at a time can catch that, so the central server does, rejecting any parent update that would create a cycle. A client that applied its own move optimistically can still see a cycle for a moment, so it just hides the cycled objects until the server's answer arrives and puts them back wherever they belong.

Lastly, siblings need an order, since dragging a layer between two others has to land it exactly there on everyone's screen. Numbering children 1, 2, 3 fails in multiplayer, because inserting into the middle renumbers every sibling after it, a pile of writes for concurrent edits to collide with. So Figma made each child's position a fraction strictly between 0 and 1, stored as a property, with siblings rendering sorted by position. Inserting between two siblings just averages their positions, so a layer dropped between siblings at 0.25 and 0.5 lands at 0.375 and nothing else gets rewritten. And since a position only means something among one parent's children, the parent link and the position travel as one atomically written property:

```
objects.get(iconID).set("parent", { parentID: frameID, position: 0.375 })
```

### One process per document

We've been leaning on this central server, so let's be clear about what it does. "Last write to reach the server" only means something if a single place sees every write. So Figma spins up a server process for each open document and connects every editor of that file to it, leaving no cross-server coordination to get right. Opening a document downloads a complete copy of the file from the server, and from then on the client holds a [WebSocket](https://www.hellointerview.com/learn/system-design/patterns/realtime-updates#websockets-the-full-duplex-champion) to that one process, with edits flowing in both directions over the socket.

!

Figma's document model

Routing every editor of a document to the same server is one of the two standard ways to get updates flowing between users. The other is a [pub/sub](https://www.hellointerview.com/learn/system-design/patterns/realtime-updates#pushing-via-pub-sub) layer that lets clients connect to any server. Our [Realtime Updates](https://www.hellointerview.com/learn/system-design/patterns/realtime-updates#server-side-push-pull) pattern compares the two.

If a client were to [drop and come back](https://www.hellointerview.com/learn/system-design/patterns/realtime-updates#how-do-you-handle-connection-failures-and-reconnection), there is no need to try to resume its old session. It just downloads the document again from scratch, replays whatever edits it made while away on top of the fresh copy, and opens a new socket. Even better, this means that offline support comes for free, since being offline for four hours is no different than being disconnected for just a few seconds.

The obvious next question is how a crashed document process gets handled. That part isn't straightforward from an infra perspective, since something has to notice the failure and hand the document to a replacement without two processes ever accepting writes for the same file. But for the clients it's just this same path again, every editor reconnecting to the replacement, downloading fresh, and replaying whatever wasn't yet acknowledged.

## Conclusion

Figma's approach was to simplify relative to the existing text-editing algorithms. A design document isn't text. Most edits change one obvious property, and any lost race is clearly visible right on the screen. So whoever cares can just make the edit again. That's why the last-writer-wins per property covers almost everything. The one case it doesn't cover is simultaneous text editing, and the post is upfront that Figma isn't optimizing for it.

From an infrastructure perspective, keeping every editor of a document connected to the same server process turned the hardest problem in the literature, agreeing on the order of events, into simple arrival order. That's the trade at the heart of this design. Figma swapped a hard algorithms problem for an infrastructure problem. Merging concurrent edits correctly is brutal to get right in code, so they made it trivial by ensuring one process sees every edit, and paid for it in operations instead. Processes now have to spin up and down, every client has to find the right one, and when a node dies its documents need a new home without two processes ever accepting writes for the same file. The win is that the infrastructure problem is smaller. Instead of ordering every edit across servers, the system only has to agree on which process owns each document, a question that comes up per session rather than per edit.

Building this today, you wouldn't start from the research the way Figma had to. The design they arrived at became the conventional one, and then it even became a product category. Sync engines like Zero and Linear's homegrown equivalent do exactly this, a server ordering optimistic mutations with last-writer-wins per property, and one process per open document is now a Cloudflare primitive (Durable Objects). The carve-out is the same one Figma drew, since concurrent text still needs a real CRDT, where Yjs has become the default. What you'd no longer do is roll the whole engine yourself, which is the clearest sign of how completely this design won.

[Read the original at Figma Engineering](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)

Mark as read

[Next: Spotify Data Lake](https://www.hellointerview.com/learn/system-design/in-the-wild/spotify-data-lake-point-queries)

<div class="comments-container w-full max-w-full min-w-0 overflow-x-hidden overflow-y-hidden pb-6"
