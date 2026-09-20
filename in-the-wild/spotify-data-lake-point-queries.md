# How Spotify Serves Point Queries from an Exabyte Data Lake

> Source: [https://www.hellointerview.com/learn/system-design/in-the-wild/spotify-data-lake-point-queries](https://www.hellointerview.com/learn/system-design/in-the-wild/spotify-data-lake-point-queries)

---

# How Spotify Serves Point Queries from an Exabyte Data Lake

By[Stefan Mai](https://www.linkedin.com/in/stefanmai/)·Published Jul 28, 2026

###### Read the Source Blog

Originally published by Spotify Engineering on July 27, 2026

[View](https://engineering.atspotify.com/2026/7/indexing-the-data-lake-for-online-point-queries/)

## The TLDR

Spotify (like all big companies) keeps most of its data in cheap object storage built to scan millions of rows at once. For decades companies have realized that data is valuable, so they almost never want to throw it away. This leads to a pattern of dumping data into inexpensive storage (a "data lake") where it's always accessible... but maybe not in the way that you want.

Data lakes are great for a weekly report or a training run. They're terrible at a single question like "what did this person listen to?" That's exactly the kind of question an online feature, or an AI agent, needs answered before the page finishes loading. The usual fix is copying whatever needs to be fast into a [database built for lookups](https://www.hellointerview.com/learn/system-design/deep-dives/dynamodb) or a [cache like Redis](https://www.hellointerview.com/learn/system-design/deep-dives/redis). This is so common that if you've worked at a mature company, it probably has a few clicks or a config that does just this. But databases and caches cost real money per gigabyte, so teams end up rationing what's worth serving online.

Spotify built a way around that trade they call RAP, short for Random Access Parquet which is an [index](https://www.hellointerview.com/learn/system-design/patterns/scaling-reads#indexing) living outside the data files that records exactly which file and rows hold a given key's data. This makes it so a lookup that used to mean hunting through files one clue at a time becomes a single precise read. They paired it with changes to how new files get written, so one user's data sits together instead of being scattered across many files. The innovation is that none of this needs a second copy of the data or a rewritten pipeline. The same files BigQuery scans for a weekly report also answer one person's question, at roughly the cost of a single storage read.

This blog is relevant for a lot of data-heavy systems. Engineers are constantly navigating the tradeoff between massive storage and fast queries, and AI agents are making this tradeoff even more acute as they start asking way more questions of the data than humans ever did. Spotify's solution is a great example of a real third option between scanning the whole lake and paying to copy everything into a key-value store.

If you've spent much time studying database internals, you'll see a lot of common threads here. Data-intensive systems is a field where functionality that databases have offered for decades gets broken by scale, then remixed to work in a new, more scalable paradigm. This is no exception, and you'll see a lot of familiar concepts show up again at a different layer.

## The problem

### Where companies actually keep their data

Before we get started, let's take a step back to describe this data lake problem in case you're unfamiliar with the idea. Feel free to skip ahead if this isn't new to you.

Every song a Spotify user plays lands as an event somewhere. The working copy everyone uses downstream lives in what's called a data lake. That just means files sitting in object storage like Google Cloud Storage or S3, not rows in a database. Think of it like a big, cheap archive.

An analyst might query those files through a query engine like Trino or BigQuery, which reads the files where they sit rather than loading them into a database first. A machine learning pipeline might read the same files for training sets. Neither is touching a database in the traditional sense. These are big sweeping scans, not the lookups and point queries an RDBMS like [Postgres](https://www.hellointerview.com/learn/system-design/deep-dives/postgres) is built for.

There's a ton of benefits here! Object storage is cheap enough per gigabyte that Spotify keeps exabytes in GCS, the full history rather than a recent window, since nobody has to ration what gets kept. And every tool reading the same files also means one copy of the truth instead of several scattered across teams.

But, there are tradeoffs.

### Organized for scans, not lookups

Picture an ordinary question: "what is the average listening time by country over the last week?"

Logically, this means touching two columns (country and listening time) across every row in that window. Spotify's lake files are Parquet files and they're made for queries just like this. Parquet is organized column by column rather than row by row. Every value from one column is packed together, then the next. The file gets sliced into row groups, each row group holds a chunk of every column, those chunks get sliced again into pages, and a footer describes where everything lives. Values from the same column compress well because they're similar. An engine can also skip whole pages it doesn't need without reading them.

If you want to learn about some of the ways that compression is achieved, we talk about them in length in our [Time Series Databases](https://www.hellointerview.com/learn/system-design/deep-dives/time-series-databases#delta-encoding-and-compression) deep dive. Worth adding to your reading list if you're interested in this topic.

To answer our question, we just have to grab these two columns from every file in the window and do some math. It's a lot of data to scan, but it's exactly the data that we need. Data lakes work pretty well for this kind of query!

![An aggregate query reading only the country and ms_played column chunks](https://www.hellointerview.com/_next/image?url=%2Fapi%2Fgenerated-image%3Fkey%3Dgenerated-images%252Fgenerate-in-the-wild-illustration%252F728d257ba5871fba-a6c9e549e40035cd-dark&w=3840&q=75&dpl=496e216d3ce87e7f3171c9d940be7a9f2d93afb8)

Reading only the columns the question asks for

Now flip the question and ask what one specific person listened to. That's a handful of rows scattered across whatever files hold that user's data, and the layout that made our average-listening-time query fast does nothing for this one. If you can't pin down exactly *where* that row lives, you end up dragging gigantic pages of data off storage to get at a few hundred bytes. On top of that you pay for a full query plan, because Trino and BigQuery schedule every query as a distributed analytical job, even one that wants a single row.

Object storage itself isn't the culprit here. A GCS request comes back in 30 to 100 milliseconds, and newer tiers like S3 Express One Zone and GCS Rapid Storage are down in single digits. It's everything wrapped around the read that costs you.

![A point query reading whole pages to reach a few scattered rows](https://www.hellointerview.com/_next/image?url=%2Fapi%2Fgenerated-image%3Fkey%3Dgenerated-images%252Fgenerate-in-the-wild-illustration%252Fb5deb0460d406f4c-9770c0594c9c39f5-dark&w=3840&q=75&dpl=496e216d3ce87e7f3171c9d940be7a9f2d93afb8)

Reading whole pages to reach one user's rows

That gap is why online features copy their data out. Whatever needs to be fast goes into Bigtable or DynamoDB, a second copy priced per gigabyte. If Spotify is like other companies, they'll either have budgets or goals to reduce the size of this tier. So everything else stays in the lake, still around but too slow to serve a page from.

Bigtable is Google's hosted wide-column store. The closest system we cover in depth is [Cassandra](https://www.hellointerview.com/learn/system-design/deep-dives/cassandra), which borrows Bigtable's storage model, if you want to see how this class of database earns its fast lookups.

Got it? Data lake: great for scanning, terrible for lookups.

## The solutions

### Narrowing ninety thousand files down to twelve

Pretty well-known approaches get you most of the way there. The parts that aren't as covered are the most interesting.

Start with the scale of the problem. Across Spotify's hundreds of millions of users, a single day's listening events land in about a thousand files. So take that same question about one person's listening, the one we just asked, and put a window on it: a roughly 90-day summer, asked either by the user opening their profile or by an agent answering on their behalf. At 1,000 files a day, that's 90,000 candidate Parquet files. This is gigabytes to terabytes of data to scan which is just not practical in any online setting (and can get prohibitively expensive offline).

What many teams do is organize their data along the dimensions their queries actually use. If lookups by user are common, then within each day the files get bucketed by user ID: hash the ID, mod it by the number of buckets, and write the result into the path.

```
date=2026-07-14/bucket=0427/part-00031.parquet
```

With 1,000 buckets, hash(user\_42) % 1000 = 427 means user 42's rows for that day can only be in bucket=0427. Not "probably" — the hash is deterministic, so every other bucket is ruled out without opening a single file. One candidate file per day instead of a thousand, and the 90,000 drops to 90.

[Bloom filters](https://www.hellointerview.com/learn/system-design/deep-dives/data-structures-for-big-data#bloom-filter) can cut it down again. A Bloom filter is a compact structure that can tell you with certainty that a key is *absent*, though never that it's present. Spotify keeps one per file's user-ID column cached in a metadata store, so a file can be ruled out without ever opening it. That narrows the 90 candidates to roughly 12, the days that user was actually active. We're just gradually pruning away the files that can't possibly contain the data we need.

![Pruning 90,000 candidate files down to 12 with bucketing and Bloom filters](https://www.hellointerview.com/_next/image?url=%2Fapi%2Fgenerated-image%3Fkey%3Dgenerated-images%252Fgenerate-in-the-wild-illustration%252F4b282d44ccb6fc36-f0727c60a6b016be-dark&w=3840&q=75&dpl=496e216d3ce87e7f3171c9d940be7a9f2d93afb8)

Pruning by bucket, then by Bloom filter

From here, we're a bit stuck and have to start reading the files. That step is where most of the time goes. Pulling a match out of a Parquet file not built for this means a chain of dependent reads.

The reader grabs the footer first to learn where the row groups sit. It parses their metadata, scans the key column for matching rows, and only then can it follow the column and page indexes down to the pages holding the values it actually wants.

Basically, bucketing and Bloom filters get you to the right files, but they still leave you doing dependent disk reads that can't be parallelized.

### An index that already knows where every key lives

Spotify's answer is RAP: an index living on disk alongside the data files but entirely outside them. A builder job reads the footers and page locations of existing Parquet files and scans the key columns. From that it writes a mapping from key to exactly where that data sits, without touching the original files. Each pipeline run appends a new fragment to the index, and old fragments are never modified. That keeps the index cheap to maintain incrementally rather than rebuilt from scratch.

The index is a multimap. One user ID shows up across many files and many partitions, so a single key maps to a *list* of entries. Each entry carries:

* **The key**, which can be compound — user\_id plus date, say, rather than just a user.
* **Which file**, stored as a dictionary-encoded ordinal instead of a full path, since the same handful of paths repeat across millions of entries.
* **The row numbers** within that file.
* **A value count**, optionally, so a reader can paginate without fetching anything first.

Indexing a terabyte of data produces gigabytes of index; a petabyte produces terabytes. Large indexes distribute by hashing keys into buckets, the same trick the data files use.

![RAP index entries mapping one key to exact rows across many files](https://www.hellointerview.com/_next/image?url=%2Fapi%2Fgenerated-image%3Fkey%3Dgenerated-images%252Fgenerate-in-the-wild-illustration%252Fb5deb0460d406f4c-becfc1af03c056ea-dark&w=3840&q=75&dpl=496e216d3ce87e7f3171c9d940be7a9f2d93afb8)

One key, three entries, three untouched files

We talked about pruning the scan space earlier, and Parquet has its own version built in. The column and page indexes store min and max values, so a reader can skip any row group or page whose range can't contain the key it wants. That skip is exact, not a guess. The Bloom filter is the probabilistic one: a definite no, or a maybe. Either way, pruning only tells you where a row can't be, never where it is.

This is where RAP is different. Its external index is definitive, so rather than narrowing a search it replaces one, resolving directly to row numbers in effectively constant time. Once cached file metadata turns those into byte ranges, the read becomes a handful of targeted ranged reads issued in parallel, since none depend on each other. A lookup that meant walking twelve files link by link becomes one index hit and one round of reads.

Note the parallelism in the graphic below:

![Five dependent reads against one index hit and three parallel ranged reads](https://www.hellointerview.com/_next/image?url=%2Fapi%2Fgenerated-image%3Fkey%3Dgenerated-images%252Fgenerate-in-the-wild-illustration%252Fb5deb0460d406f4c-c96d7cf8fc672c93-dark&w=3840&q=75&dpl=496e216d3ce87e7f3171c9d940be7a9f2d93afb8)

Five reads that wait on each other, against three that don't

There's a real limit, though. Against untouched files, the reader still fetches the whole page containing the target row, since a page is the smallest addressable unit and can run large, up to around 4 MB, even when the row wanted holds maybe 100 bytes. Getting the read smaller than the page meant changing how the files are written in the first place.

A lot of engineers will make the mistake of assuming they can read individual bytes off the disk only to be foiled by the operating system and page boundaries. Remember that your system's performance is going to revolve around atomic units of data. This is what enables you to design systems that are *actually fast* running on real hardware and operating systems, not just in theory.

If you're building systems like this, your benchmark will tell you when you're misleading yourself but strong engineers will know these are things to keep in mind at all times.

These are good wins already, but can we do more? Spotify proposes a couple more sets of optimizations.

### Preparing files so the read shrinks

An index solves finding a key. It doesn't shrink what you read once you get there. You're stuck on that because the layout was fixed back when the file was written. So Spotify changed the write side too.

The first is putting one key's rows physically together. Sorting by key is the simplest version and it's often close to free, since plenty of pipelines already emit sorted output anyway. On top of that, Spotify's writer can start a new page every time the key changes.

The page is still the smallest thing you can read. That doesn't change and you can't ask for half of one. What changes is what's sitting inside it. A page used to be a 4 MB slab holding your 100 bytes plus a few thousand other users' rows, and you paid to fetch and decompress all of it. Break on every key change and the page holds one key and nothing else, so it's small, and every byte in it is a byte you came for.

All that page-splitting costs about 20 bytes of header per boundary, which is nothing against real per-key volume. The files stay standard Parquet too, so every other reader carries on none the wiser.

![One key's rows scattered across pages, then gathered into one](https://www.hellointerview.com/_next/image?url=%2Fapi%2Fgenerated-image%3Fkey%3Dgenerated-images%252Fgenerate-in-the-wild-illustration%252Fb5deb0460d406f4c-99d2f1b3de7e0cd2-dark&w=3840&q=75&dpl=496e216d3ce87e7f3171c9d940be7a9f2d93afb8)

The same rows, scattered then gathered

The second trick they outline is skipping the read altogether. The index builder already walks every row while it's building the mapping. It may as well copy small values straight into the index entry while it's there. That makes it a [covering index](https://www.hellointerview.com/learn/system-design/core-concepts/db-indexing#covering-indexes) (see the connection back to databases?). The answer is sitting in the index, and there's no storage read at all. Spotify pushes the same trick to precomputed aggregates like a key's event count or its total play time.

Between the two, each matching file comes down to one ranged read of a few kilobytes, or nothing at all when the index already holds the answer. And since bucketing keeps the number of matching files small, the whole lookup is still just that handful of parallel reads.

### Secondary indexes without touching the data

Not every dataset has one natural key. A transactions table might need lookups by buyer\_id one day and seller\_id the next.

Because RAP is a structure sitting over files it never modifies, adding a second dimension is just a decision made at the serving layer. Build another access structure over the same entries and you can look up by seller\_id too. The pipelines don't change and the data files are never rewritten, which is the whole pitch: a new index costs you an index, not a migration. [DynamoDB secondary indexes](https://www.hellointerview.com/learn/system-design/deep-dives/dynamodb#secondary-indexes) answer the same need, though there the index is a managed copy of the data rather than a map over it.

The catch is that the files are still sorted and bucketed by the original key. A seller\_id lookup scatters across far more files than a buyer\_id one. RAP can only soften that by merging adjacent byte ranges into fewer requests. A secondary lookup is never as cheap as the primary.

## Conclusion

Data lives on a continuum between cheap and accessible for scans and expensive but useful for point lookups and queries. RAP adds one more point on that continuum. It's an index built over files that already exist, cheap enough to maintain that it doesn't force the same rationing.

The write-up doesn't give an outcome, though. There's no end-to-end latency number for a RAP lookup in production or an account of how many features have adopted it. What Spotify describes is architecture, and the financial argument is a claim rather than something they try to measure or make the case for in the blog post. So treat it with a degree of skepticism.

The real takeaway here is that this solution bolts on to their existing infrastructure, which means they're not managing a gigantic migration or fragmenting their data infrastructure. You'll see this again and again in our [In the Wild](https://www.hellointerview.com/learn/system-design/in-the-wild) series. Companies make big bets and adapt around them rather than trying to change everything at once. This "organic system design" is why real-world systems look the way they do and why our [Delivery Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery-framework) advocates a similar process for system design interviews.

[Read the original at Spotify Engineering](https://engineering.atspotify.com/2026/7/indexing-the-data-lake-for-online-point-queries/)

Mark as read

[Next: Meta ZGateway](https://www.hellointerview.com/learn/system-design/in-the-wild/meta-zgateway-zippydb)

<div class="comments-container w-full max-w-full min-w-0 overflow-x-hidden overflow-y-hidden pb-6"
