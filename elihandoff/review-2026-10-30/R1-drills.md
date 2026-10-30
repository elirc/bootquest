# R1 — Drill banks review (csdrills 72 · javadrills 80 · sysdrills 129)

Read-only review, main @ 772b19cb, 2026-10-30. Scope: `tools/seed/authoring/{csdrills,javadrills,sysdrills}`.
Method: topic map generated from the authoring JSON (counts verified: 72 / 80 / 129); 45 drills read in full
(10 C#, 13 Java, 22 sysdesign) spread across modules and ages (sysdrills 01-03 = 2026-10-20 wave 1, 04-10 =
waves 2/3, 11-14 = wave 4, 15-18 = cw 2026-10-30; csdrills/javadrills 01-05 = 10-23, 06-10 = 10-24, java 11 =
10-26); every one of the 129 sysdrills solutions and starters executed against its tests under node 22.16
(`recompute.mjs`: 129/129 solutions pass, 0 starters pass, 0 wrong expected values); 11 expected values
re-derived by hand (listed under Quality findings); weekday, hash and rounding vectors in the sampled C#/Java
drills re-derived with node. Backlog cross-check: `docs/SEEDING.md` §8 (lines 1440-1731) and
`elihandoff/README.md` "Next ideas".

Headline:
1. sysdrills modules 01-03 (22 drills, wave 1) carry the reference solution verbatim as hint 3 — the one
   rule every later wave states ("hint 3 never pasteable code", SEEDING.md:1038/1042/1062). Latent today
   (hints are "not served yet", `shared/src/api.ts:387`) but it is the whole answer the day progressive hints
   ship, and the qw report item (SEEDING.md:1658) lists only 11/07, 12/03, 14/03.
2. sysdrills 01-14: 95 of 111 "Your task" sections hand over the exact formula in backticks (e.g.
   `qps × latencyMs / 1000`), hint 2 repeats it, so the drill tests typing, not reasoning. The cw modules
   15-18 (0 of 18) show the fixed shape: semantics in the task, formula only in hint 2, discriminating tests.
3. The cs/java banks are strong (interview-shaped, naive answers caught by named tests, 0 factual errors
   found in 23 read); their weakness is structural — the "Contract" paragraph often spells out the algorithm
   step by step, so several d2/d3 drills are transcription. The big content gap is the missing JS/TS leg
   (handoff idea #5), plus transactions/isolation, job queues & leases, and LINQ/JSON-boundary semantics.

---

## 1. Topic map

Columns: slug | title | difficulty | skills | test count. Slug gaps (e.g. csdrills 02 has no 01) are qw
retirements; numbers are never reused.


### csdrills/01-linq-set-reconciliation — LINQ set ops & list reconciliation (8)
| 01-sync-added-removed | Sync a tag list: added and removed | d2 | Except, reconciliation | t5 |
| 02-kept-and-same | Kept items and "did anything change?" | d2 | Intersect, SequenceEqual | t6 |
| 03-dedupe-by-key | Dedupe signups by canonical email | d2 | DistinctBy, canonical keys | t5 |
| 04-batch-membership | Validate a batch of ids in one pass | d1 | ToHashSet, lookup cost | t5 |
| 05-minby-maxby | Cheapest plan and price spread | d1 | MinBy, MaxBy | t5 |
| 06-zip-pairing | Zip two parallel columns into labels | d1 | Zip, silent truncation | t4 |
| 07-any-all-vacuous | Any/All on empty collections | d1 | Any/All, vacuous truth | t6 |
| 08-version-reconcile | Client cache sync by id and version | d2 | keyed diff, cache sync | t6 |

### csdrills/02-async-composition — Async composition without the clock (7)
| 02-memoize-the-task | Memoize the Task, not the result | d2 | task caching, stampede prevention | t4 |
| 03-whenany-first-wins | First replica to answer wins | d2 | WhenAny, hedged reads | t6 |
| 04-sync-throw-vs-faulted | Validate eagerly: throw before the Task | d3 | eager validation, async local functions | t4 |
| 05-sequential-pipeline | Strictly one at a time, in order | d2 | ordered awaits, sequential pipelines | t5 |
| 06-tcs-bridge | Bridge a callback into a Task | d2 | TaskCompletionSource, callback bridging | t4 |
| 07-try-load-funnel | Catch the expected failure only | d2 | expected vs unexpected failure, selective catch | t4 |
| 08-task-status-snapshot | Health endpoint: describe a Task | d1 | TaskStatus flags, terminal states | t4 |

### csdrills/03-enums-and-flags — Enums, flags & permission masks (7)
| 02-revoke-and-toggle | Revoke and toggle rights | d2 | and-not, xor | t6 |
| 03-any-vs-all-mask | Any-of vs all-of mask checks | d2 | mask semantics, vacuous empty mask | t7 |
| 04-parse-status-safely | Parse a status safely (the TryParse("99") trap) | d2 | Enum.TryParse, Enum.IsDefined | t8 |
| 05-wire-names | Stable wire names for an enum | d1 | stable string contract, dictionary mapping | t5 |
| 06-flags-to-names | Render a mask as its right names | d2 | decomposition, declaration order | t4 |
| 07-count-and-single | Count rights; is it exactly one? | d2 | popcount, power of two | t6 |
| 08-role-matrix | Effective permissions from roles | d3 | composition, fail closed | t6 |

### csdrills/04-money-and-rounding — Money, decimal & rounding (5)
| 01-cents-roundtrip | Store money as integer cents | d1 | decimal to cents, exact conversion | t6 |
| 02-midpoint-rounding | Banker's rounding vs half-up | d2 | MidpointRounding, invoice rounding | t5 |
| 03-vat-in-cents | VAT in integer cents, half-up | d2 | integer rounding, tax math | t6 |
| 05-weighted-allocation | Weighted split: largest remainder | d3 | largest remainder, proportional allocation | t5 |
| 07-strict-money-parse | Strict money parsing (the 100× bug) | d2 | NumberStyles, input validation | t7 |

### csdrills/05-time-and-scheduling — Instants, buckets & calendars (8)
| 01-epoch-roundtrip | Unix seconds round-trip | d1 | Unix time, instants vs offsets | t7 |
| 03-utc-buckets | UTC hour and day buckets | d2 | UTC bucketing, cross-midnight trap | t5 |
| 04-add-months-clamp | Billing anniversaries: AddMonths clamp and drift | d3 | AddMonths clamping, end-of-month policy | t6 |
| 05-booking-overlap | Booking overlap with half-open stays | d2 | half-open ranges, overlap test | t8 |
| 06-week-start | ISO week start (Monday) from any date | d2 | DayOfWeek arithmetic, enum-zero trap | t4 |
| 07-grace-and-gaps | Whole days between, and grace windows | d1 | duration comparisons, inclusive deadlines | t5 |
| 08-kind-hygiene | DateTimeKind hygiene at the database edge | d2 | DateTimeKind, SpecifyKind vs ToUniversalTime | t5 |
| 09-dst-wall-clock | DST wall clock: a day is not 24 hours | d3 | TimeZoneInfo, DST gap and overlap, calendar day vs elapsed time | t7 |

### csdrills/06-text-at-the-edge — Strings at the API edge (8)
| 02-build-query | Build a query string | d2 | query composition, percent-encoding | t5 |
| 03-parse-query | Parse a query string tolerantly | d3 | tolerant parsing, plus vs %2B | t5 |
| 04-mask-pii | Mask PII before it reaches the logs | d1 | masking, index slicing | t5 |
| 05-route-template | Fill a route template | d2 | token filling, fail loudly | t4 |
| 06-link-header | Pagination Link header | d2 | pagination envelope, RFC 8288 Link | t4 |
| 07-auth-headers | Parse Bearer and Basic auth headers | d3 | header parsing, never throw at the edge | t8 |
| 08-clean-input | Normalize whitespace in user input | d1 | normalization, whitespace runs | t5 |
| 09-utf8-byte-budget | Truncate to a UTF-8 byte budget | d2 | UTF-8 byte counts, System.Text.Rune, surrogate pairs | t8 |

### csdrills/07-hashing-and-identifiers — Hashes, encodings & identifiers (6)
| 01-utf8-base64 | UTF-8 text to Base64 and back | d1 | Convert.ToBase64String, Encoding.UTF8 | t5 |
| 02-base64url | Base64Url: the URL-safe alphabet | d2 | Base64Url, padding | t6 |
| 03-sha256-hex | SHA-256 as lowercase hex | d2 | SHA256.HashData, lowercase hex | t4 |
| 04-idempotency-key | Idempotency key from a canonical request | d2 | canonicalization, request hashing | t4 |
| 06-luhn | The Luhn checksum | d2 | checksum, right-to-left digits | t7 |
| 07-stable-bucket | Stable bucket hashing | d2 | persistable hashing, unsigned overflow | t6 |

### csdrills/08-service-data-structures — Build the structure: caches, buffers, counters (6)
| 01-lru-cache | LRU cache | d3 | LRU eviction, dictionary + linked list | t6 |
| 02-ring-buffer | Ring buffer of recent items | d2 | ring buffer, bounded history | t5 |
| 03-top-k | Top-K events with deterministic ties | d2 | counting, deterministic tie-break | t4 |
| 04-sliding-window | Sliding-window rate counter | d3 | sliding window, injected time | t5 |
| 05-token-bucket | Token bucket | d3 | token bucket, injected time | t5 |
| 07-undo-redo | Undo / redo history | d2 | two stacks, branch-point rule | t6 |

### csdrills/09-thread-safety — Shared state & thread safety (9)
| 01-interlocked-counter | Interlocked hit counter | d2 | Interlocked, lost updates | t4 |
| 02-lock-check-then-act | Lock around check-then-act | d2 | lock, check-then-act race | t4 |
| 03-concurrent-tally | Concurrent tally with AddOrUpdate | d2 | ConcurrentDictionary.AddOrUpdate, atomic update | t4 |
| 04-getoradd-lazy | GetOrAdd + Lazy: build it exactly once | d3 | GetOrAdd race, Lazy<T> wrap | t4 |
| 05-defensive-snapshot | Defensive snapshots | d2 | copy-out, aliasing | t4 |
| 07-atomic-reload | Atomic config reload by reference swap | d2 | reference swap, immutable snapshot | t4 |
| 08-drain-the-queue | Drain a concurrent queue | d2 | ConcurrentQueue, order-agnostic asserts | t4 |
| 09-bounded-channel-inbox | Bounded inbox with Channel<T>: backpressure | d2 | System.Threading.Channels, backpressure, BoundedChannelFullMode | t6 |
| 10-async-concurrency-limiter | Async concurrency limiter with SemaphoreSlim | d3 | SemaphoreSlim.WaitAsync, try/finally release, cancellation | t5 |

### csdrills/10-crud-endpoint-logic — List-endpoint & write-endpoint logic (8)
| 01-page-envelope | Page envelope: totalPages and hasNext | d1 | ceiling division, paging contracts | t8 |
| 02-clamp-params | Clamp paging parameters | d1 | defensive defaults, offset math | t8 |
| 03-sort-whitelist | Sort through a whitelist | d2 | injection-proof sorting, direction prefix | t6 |
| 04-optional-filters | Optional filters: null means not sent | d2 | nullable criteria, conjunction | t6 |
| 05-cursor-token | Opaque cursor tokens | d2 | opaque cursors, never throw at the edge | t7 |
| 06-etag-precondition | ETag and If-Match preconditions | d2 | optimistic concurrency, HTTP 412 | t8 |
| 08-merge-patch | JSON merge patch on a dictionary | d3 | RFC 7386 merge patch, null deletes | t5 |
| 09-conditional-create | Conditional PUT: If-None-Match * and If-Match | d2 | HTTP preconditions, create-only PUT, 412 Precondition Failed | t7 |

### csdrills total: 72

### javadrills/01-collections-behavior — Collections: views, copies and contracts (8)
| 01-three-list-factories | Three ways to make a list | d1 | List, immutability | t5 |
| 02-sublist-window | A window, not a copy | d2 | List, views | t5 |
| 03-view-vs-copy | The read-only view that kept changing | d1 | List, immutability | t5 |
| 04-first-seen-order | Counts in first-seen order | d2 | LinkedHashMap, ordering | t4 |
| 05-peek-vs-insert | Looking without touching | d2 | Map, side effects | t4 |
| 06-priority-poll | Heap order is poll order | d2 | PriorityQueue | t5 |
| 07-floor-tier | Which tier is this score? | d2 | TreeMap, NavigableMap | t5 |
| 08-set-of-rules | The set that refused a duplicate | d1 | Set, immutability | t5 |

### javadrills/02-equality-and-ordering — Equality, hashing and ordering contracts (9)
| 01-overflow-safe-comparator | The comparator that overflowed | d2 | Comparator, overflow | t4 |
| 02-treeset-tiebreak | The word the TreeSet ate | d2 | TreeSet, comparator vs equals | t4 |
| 03-numeric-ids | Why 10 sorted before 9 | d1 | ordering | t4 |
| 04-case-insensitive-key | Equal tags, different buckets | d2 | equals/hashCode | t6 |
| 05-arrays-make-bad-keys | Arrays make bad keys | d2 | arrays, equality | t4 |
| 06-objects-null-safety | Null-safe by helper | d1 | Objects | t5 |
| 07-stable-sort-promise | The sort that kept its promise | d2 | sorting, stability | t5 |
| 08-record-with-array | The record that forgot its contents | d3 | records, equality | t7 |
| 09-mutable-hashmap-key | The key that vanished | d2 | HashMap, hashCode, mutable keys | t5 |

### javadrills/03-streams-execution — Streams: when does the work happen (8)
| 01-lazy-until-terminal | Nothing happens until you ask | d2 | streams, laziness | t4 |
| 02-short-circuit | The search that stopped early | d2 | streams, findFirst | t4 |
| 03-one-shot-streams | A stream is used up | d1 | streams | t4 |
| 04-infinite-to-finite | Cutting an endless stream | d2 | Stream.iterate, limit/takeWhile | t4 |
| 05-indexed-stream | Streams with an index | d1 | IntStream | t4 |
| 06-distinct-uses-equals | What distinct thinks is a duplicate | d2 | distinct, records | t5 |
| 07-sorted-buffers-everything | The limit that did not save any work | d2 | streams, stateful ops | t4 |
| 08-flatten | Splicing streams together | d2 | flatMap | t4 |

### javadrills/04-collectors — Collectors beyond toList (8)
| 01-joining | Joining with a frame | d1 | Collectors.joining | t4 |
| 02-counting-downstream | How many of each length | d2 | groupingBy, counting | t5 |
| 03-mapping-downstream | Names by department | d2 | groupingBy, mapping | t4 |
| 04-summarizing | Four statistics, one pass | d2 | IntSummaryStatistics | t4 |
| 05-collectingandthen | Collect, then freeze | d2 | Collectors.collectingAndThen, immutability | t6 |
| 06-teeing | Two collectors, one pass | d2 | Collectors.teeing | t6 |
| 07-tocollection | Let the collection choose | d1 | Collectors.toCollection | t4 |
| 08-flatmapping-filtering | Filter inside the bucket | d3 | downstream composition | t4 |

### javadrills/05-optional-discipline — Optional as an API, not a null wrapper (5)
| 01-orelse-vs-orelseget | The fallback that was never needed | d2 | Optional, lazy evaluation | t6 |
| 03-ifpresentorelse | Two branches, one call | d1 | Optional, side effects | t4 |
| 04-orelsethrow | Fail loudly, with the id | d2 | Optional, exceptions | t4 |
| 05-optional-stream | Drop the gaps | d1 | Optional, streams | t4 |
| 08-flatten-nested | Optional inside Optional | d2 | Optional, flatMap, lazy evaluation | t5 |

### javadrills/06-strings-and-text — Strings: the methods behind the traps (8)
| 01-strip-vs-trim | The space that trim could not see | d2 | whitespace, String.strip | t5 |
| 02-lines-and-blank | Lines, every flavour of them | d2 | String.lines, String.isBlank | t6 |
| 03-stringbuilder-editing | Editing a card number in place | d2 | StringBuilder | t6 |
| 04-codepoints | The emoji that counted as two | d3 | surrogate pairs, code points | t4 |
| 05-join | Joining without the trailing slash | d1 | String.join | t5 |
| 06-index-windows | Slicing by anchors | d2 | indexOf, substring | t6 |
| 07-chars-pipeline | A string as a stream of ints | d2 | String.chars, IntStream | t5 |
| 08-replace-vs-replaceall | The dot that matched everything | d2 | String.replace, regex | t5 |

### javadrills/07-exception-flow — Exceptions: the control flow you must predict (8)
| 01-finally-always | The audit line that always lands | d1 | try/finally | t4 |
| 02-catch-order | Which catch wins | d2 | multi-catch, exception hierarchy | t5 |
| 03-root-cause | What actually started it | d2 | cause chains | t5 |
| 04-keep-the-primary | The cleanup that hid the real error | d3 | suppressed exceptions | t6 |
| 05-requirenonnull | Guard clauses at the door | d1 | Objects, guard clauses | t5 |
| 07-data-carrying-exception | An exception the catcher can read | d2 | custom exceptions, unchecked | t4 |
| 08-rethrow-same | Log it or handle it, not both | d2 | rethrow discipline | t4 |
| 09-finally-traps | The finally that ate the exception | d2 | try/finally, return semantics | t5 |

### javadrills/08-money-math — Money: integer cents and BigDecimal discipline (6)
| 01-weighted-allocation | Splitting a dollar by weight | d3 | allocation, largest remainder | t5 |
| 02-line-vs-invoice-rounding | The cent the invoice disagreed on | d2 | rounding policy, reconciliation | t5 |
| 03-basis-points | Thirty basis points of a payment | d2 | basis points, integer rounding | t7 |
| 06-cross-rate | The round trip that moved a cent | d3 | BigDecimal, HALF_EVEN | t5 |
| 07-installments | Who pays the odd cent | d1 | installments, remainder policy | t6 |
| 08-discount-order | Ten percent, then five dollars — or the other way | d2 | discounts, policy order | t8 |

### javadrills/09-instants-and-zones — Instants, offsets and zones (8)
| 01-epoch-instants | A moment as a number | d1 | Instant, epoch millis | t5 |
| 02-duration-between | How late is the ticket | d2 | Duration | t5 |
| 03-wall-clock-is-not-a-moment | Nine o'clock where | d2 | LocalDateTime, ZoneOffset | t5 |
| 04-same-instant-vs-same-local | Same meeting or same clock face | d2 | ZonedDateTime, zone conversion | t5 |
| 05-dst-day | The day with 23 hours | d3 | DST, Period vs Duration | t5 |
| 06-truncation-buckets | Bucketing events by the hour | d2 | Instant, truncation | t5 |
| 07-compare-across-zones | Which call happened first | d2 | ZonedDateTime, ordering | t6 |
| 08-epoch-day-boundaries | The last millisecond of the day | d2 | LocalDate, epoch millis | t5 |

### javadrills/10-completablefuture-composition — CompletableFuture without threads (9)
| 01-thenapply-vs-thencompose | The future inside a future | d2 | CompletableFuture, thenApply vs thenCompose | t5 |
| 03-handle-both-paths | One stage for success and failure | d2 | CompletableFuture.handle | t5 |
| 04-fallback-service | Only call the backup when needed | d3 | exceptionallyCompose, laziness | t4 |
| 05-promise-contract | The first completion wins | d2 | CompletableFuture.complete, getNow | t4 |
| 06-failure-skips-stages | The stage that never ran | d2 | CompletableFuture, failure propagation | t7 |
| 07-stage-kinds | Apply, accept, run | d1 | CompletableFuture, stage kinds | t4 |
| 08-compose-and-copy | A summary nobody can change | d2 | CompletableFuture, immutability | t5 |
| 09-settle-all | Every answer, even the failures | d3 | CompletableFuture.allOf, handle | t6 |
| 10-whencomplete-vs-handle | Watch it or change it | d2 | CompletableFuture.whenComplete, handle | t5 |

### javadrills/11-cross-language-bugs — Cross-language traps (3)
| 01-rounding-mode | Half-even vs half-up on negative money | d2 | rounding modes, BigDecimal | t7 |
| 07-double-equality-traps | The reading that never equals itself | d2 | double, NaN, equality | t7 |
| 08-utf8-byte-budget | Truncate to a byte budget | d2 | UTF-8, code points | t7 |

### javadrills total: 80

### sysdrills/01-estimation — Estimation: traffic, storage & cost (8)
| 01-qps-from-dau | Average QPS from daily active users | d1 | estimation, traffic | t5 |
| 02-peak-qps | Peak QPS and the busiest hour | d1 | estimation, traffic | t5 |
| 03-storage-growth | Storage growth per day and per year | d1 | estimation, storage | t5 |
| 04-bandwidth-budget | Egress bandwidth in bytes/s and Mbps | d1 | estimation, bandwidth | t5 |
| 05-cache-working-set | Cache working set and node count | d2 | estimation, caching | t5 |
| 06-cost-per-month | Monthly fleet cost in cents | d2 | estimation, cost | t5 |
| 07-littles-law | Little's law: requests in flight | d1 | estimation, queueing | t5 |
| 08-latency-budget | What is left of the p99 latency budget | d1 | estimation, latency | t5 |

### sysdrills/02-caching-and-pools — Caching, pools & limits (6)
| 01-effective-latency | Effective latency and database load behind a cache | d2 | caching, latency | t5 |
| 02-lru-capacity | LRU capacity and evictions per hour | d2 | caching, capacity | t5 |
| 03-connection-pool | Connection pool size with headroom | d2 | capacity, queueing, databases | t5 |
| 04-rate-limit-window | Fixed-window rate limiting | d2 | rate-limiting | t5 |
| 05-token-bucket | Token bucket: refill, cap and admit | d2 | rate-limiting | t5 |
| 06-shard-count | Shard count: storage-bound or write-bound | d2 | sharding, capacity | t4 |

### sysdrills/03-reliability-math — Reliability math: quorums, availability & retries (8)
| 01-quorum-check | Read/write quorums | d2 | replication, consistency | t4 |
| 02-availability-ppm | Availability in series and in parallel (ppm) | d3 | availability | t5 |
| 03-error-budget | Error budget: downtime allowed per month | d2 | availability, slo | t5 |
| 04-exponential-backoff | Capped exponential backoff | d3 | retries, resilience | t5 |
| 05-jitter-bounds | Full and equal jitter bounds | d3 | retries, resilience | t5 |
| 06-retry-budget | Worst-case time of a retry policy | d3 | retries, latency | t5 |
| 07-mtbf-availability | Availability from MTBF and MTTR | d3 | availability | t5 |
| 08-replication-staleness | How stale can a replicated read be? | d3 | replication, consistency | t5 |

### sysdrills/04-networking-and-latency — Networking & latency math (8)
| 01-rtt-to-first-byte | Round trips before the first byte | d1 | networking, latency | t6 |
| 02-bandwidth-delay-product | Bandwidth-delay product and the window cap | d2 | networking, throughput | t6 |
| 03-nearest-rank-percentile | p50 and p99 by nearest rank | d2 | latency, percentiles | t6 |
| 04-tail-at-fanout | Tail latency at fan-out | d3 | latency, percentiles | t8 |
| 05-retries-within-deadline | How many tries fit in the deadline | d2 | timeouts, retries | t6 |
| 06-timeout-cascade | Timeout budgets down a call chain | d2 | timeouts, architecture | t5 |
| 07-payload-transfer-time | Payload time on the wire | d1 | networking, bandwidth | t5 |
| 08-latency-slo-budget | A latency SLO as a request budget | d2 | slo, percentiles | t5 |

### sysdrills/05-sql-and-indexing — SQL & indexing math (8)
| 01-selectivity | Selectivity: is this column worth an index? | d1 | sql, indexing | t5 |
| 02-rows-examined-vs-returned | Rows examined vs rows returned | d2 | sql, indexing | t5 |
| 03-btree-depth | B-tree depth and page reads per lookup | d2 | indexing, storage | t6 |
| 04-covering-index | What a covering index saves | d2 | indexing, io | t5 |
| 05-offset-pagination-cost | What OFFSET pagination really scans | d1 | sql, pagination | t5 |
| 06-index-write-amplification | What every index costs on writes | d1 | indexing, writes | t5 |
| 07-join-strategy-reads | Nested-loop or hash join? | d3 | sql, joins | t5 |
| 08-index-memory-fit | When the index outgrows RAM | d2 | indexing, capacity | t5 |

### sysdrills/06-concurrency-and-throughput — Concurrency & throughput math (8)
| 01-queue-drain-time | Queue drain time and backlog projection | d1 | queues, throughput | t6 |
| 02-utilisation-headroom | Utilisation and servers for a target | d1 | capacity, throughput | t5 |
| 03-lock-serialization | One lock caps the whole fleet | d2 | concurrency, locks | t5 |
| 04-littles-law-worker-pool | Little's law: sizing a worker pool | d2 | littles-law, concurrency | t5 |
| 05-batching-amortization | Batching amortizes the fixed cost | d2 | batching, throughput | t6 |
| 06-pipeline-bottleneck | Pipeline throughput and latency | d1 | throughput, pipelines | t5 |
| 07-retry-storm | Retry storms and retry budgets | d2 | retries, throughput | t5 |
| 08-amdahl-runtime | Amdahl's law: the serial part wins | d3 | concurrency, parallelism | t6 |

### sysdrills/07-hashing-and-sharding — Hashing, sharding & partitioning math (8)
| 01-modulo-vs-consistent | Keys moved: modulo vs consistent hashing | d2 | sharding, hashing | t5 |
| 02-node-loss-load | When a node dies: load on the survivors | d2 | sharding, consistent-hashing | t5 |
| 03-hot-key-skew | Hot-key skew on one shard | d2 | sharding, skew | t5 |
| 04-rebalance-cost | Rebalance: bytes to move and copy time | d2 | sharding, operations | t5 |
| 05-partition-pruning | Partition pruning on time ranges | d1 | partitioning, sql | t5 |
| 06-weighted-vnodes | Weighted vnodes: keys follow ownership | d2 | consistent-hashing, capacity | t5 |
| 07-scatter-gather | Scatter-gather amplification | d3 | sharding, query-routing | t5 |
| 08-partitions-and-consumers | Partitions cap consumer parallelism | d1 | partitioning, queues | t6 |

### sysdrills/08-encoding-and-counting — Encoding, storage & operation counting (8)
| 01-utf8-bytes | UTF-8 bytes vs characters | d1 | encoding | t6 |
| 02-base64-overhead | Base64 overhead | d1 | encoding | t5 |
| 03-row-size | Row size and table size | d1 | storage, schema | t5 |
| 04-page-math | Rows per page and page counts | d2 | storage, io | t5 |
| 05-loop-op-counts | Counting loop operations | d1 | big-o, counting | t6 |
| 06-binary-search-steps | Binary search: probes to find anything | d2 | big-o, search | t5 |
| 07-map-vs-nested-scan | Hash map vs nested scan | d2 | big-o, data-structures | t5 |
| 08-array-doubling | Doubling arrays: amortized O(1) appends | d3 | big-o, amortized | t5 |

### sysdrills/09-queues-and-backlog — Queues & backlog math (8)
| 01-queue-position-eta | When does my job run? Queue position math | d1 | queues, latency | t6 |
| 02-backlog-sla-threshold | Backlog alert threshold from a freshness SLA | d2 | queues, slo | t6 |
| 03-consumers-to-drain | Consumers needed to drain a lag by a deadline | d2 | queues, capacity | t6 |
| 04-retry-amplification | Retry amplification across layers | d3 | retries, architecture | t6 |
| 05-dlq-sizing | Sizing a dead-letter queue | d1 | queues, storage | t6 |
| 06-batch-vs-single-requests | Batching against a partner rate limit | d2 | batching, rate-limiting | t6 |
| 07-fanout-backlog | Fan-out on write: delivery rate and celebrity lag | d2 | queues, fan-out | t6 |
| 08-load-shedding | Load shedding during overload | d1 | overload, throughput | t6 |

### sysdrills/10-capacity-and-cost — Capacity planning & cost math (8)
| 01-cores-for-load | CPU time to cores to instances | d2 | capacity, cpu | t6 |
| 02-storage-egress-bill | Storage and egress: the monthly data bill | d1 | cost, storage | t6 |
| 03-cost-per-million | Cost per million requests and the serverless breakeven | d2 | cost, unit-economics | t5 |
| 04-autoscale-steps | Autoscaling: target tracking and step timing | d2 | autoscaling, capacity | t7 |
| 05-read-replica-sizing | Read replicas that also replay every write | d3 | replication, capacity | t6 |
| 06-replication-and-backups | Replication and backup footprint | d1 | storage, cost | t5 |
| 07-iops-budget | IOPS budget with a warm and a cold cache | d3 | capacity, io | t6 |
| 08-pool-per-instance | Splitting a database connection budget across a fleet | d2 | databases, capacity | t6 |

### sysdrills/11-replication-and-consistency — Replication & consistency math (8)
| 01-quorum-step-latency | Quorum latency: the k-th ack, not the last | d2 | replication, latency | t6 |
| 02-freshness-read-routing | Routing fresh reads: what the primary really carries | d1 | replication, capacity | t6 |
| 03-read-repair-volume | Read repair: the writes your reads create | d2 | consistency, writes | t6 |
| 04-anti-entropy-sync | Anti-entropy: full compare vs Merkle trees | d2 | replication, bandwidth | t6 |
| 05-pitr-restore-time | Point-in-time restore: snapshot copy plus WAL replay | d2 | durability, operations | t6 |
| 07-lag-breach-eta | Replica lag: how long until the SLA breaks | d2 | replication, slo | t6 |
| 08-stale-read-share | Stale reads: lag over update interval | d2 | consistency, staleness | t6 |
| 09-quorum-zone-placement | Quorum placement: surviving the loss of a whole zone | d2 | replication, availability | t7 |

### sysdrills/12-multi-region-and-failover — Multi-region & failover math (8)
| 01-failover-rpo | Failover RPO: what the lag window loses | d1 | replication, durability | t6 |
| 02-failover-rto | Failover RTO: detection, promotion, DNS | d2 | availability, operations | t6 |
| 03-region-loss-capacity | N+1 regions: surviving the loss of one | d2 | capacity, availability | t6 |
| 04-failover-error-burn | One failover, how much error budget | d2 | slo, availability | t6 |
| 05-replication-mesh-egress | Replication mesh: the cross-region egress bill | d2 | cost, bandwidth | t6 |
| 07-standby-cost | Hot-hot vs pilot light: what DR costs | d1 | cost, availability | t6 |
| 08-consensus-rtt-cap | Cross-region consensus: the speed-of-light cap | d2 | consensus, throughput | t6 |
| 09-chatty-cross-region | Chatty pages across regions: the round trips add up | d2 | latency, networking | t7 |

### sysdrills/13-search-and-indexing — Search & indexing at scale (8)
| 01-inverted-index-size | Inverted index size: postings, not pages | d1 | search, storage | t6 |
| 02-posting-list-costs | Posting-list merges: walk everything, match the rarest | d2 | search, query | t9 |
| 03-fanout-topk-overfetch | Fan-out top-K: the candidates behind ten results | d2 | search, sharding | t6 |
| 04-refresh-visibility-lag | Refresh interval: when a write becomes searchable | d1 | search, freshness | t6 |
| 05-segment-merge-writes | Segment merges: the writes behind the ingest | d2 | search, io | t6 |
| 06-ranking-cost-budget | Two-phase ranking: affording the expensive model | d2 | search, latency | t6 |
| 07-search-cluster-sizing | Search cluster sizing: fan-out multiplies replicas | d2 | search, capacity | t6 |
| 08-vector-index-memory | Vector index memory: every embedding in RAM | d1 | search, capacity | t6 |

### sysdrills/14-observability-and-telemetry — Observability & telemetry math (9)
| 01-trace-sampling-budget | Trace sampling: set the dial from the budget | d2 | observability, cost | t6 |
| 02-metric-cardinality | Metric cardinality: every label multiplies | d1 | observability, cost | t6 |
| 03-log-retention-tiers | Log retention tiers: demotion is the lever | d2 | observability, cost | t6 |
| 04-error-budget-burn-rate | Burn rate: how fast the error budget empties | d2 | slo, alerting | t6 |
| 05-alert-noise-toil | Alert noise: the on-call hours false pages burn | d1 | alerting, operations | t6 |
| 06-telemetry-overhead | Instrumentation overhead: the tax on fast requests | d1 | observability, latency | t6 |
| 07-metrics-resolution | Scrape resolution: the points a TSDB must hold | d1 | observability, storage | t6 |
| 08-head-vs-tail-sampling | Head vs tail sampling: keeping the evidence | d3 | observability, debugging | t6 |
| 09-multi-window-burn-alert | Burn-rate alerts: threshold and two windows | d2 | slo, alerting | t9 |

### sysdrills/15-node-service-runtime — Node service runtime limits (5)
| 01-event-loop-stall | One synchronous call stalls every request | d2 | node, latency | t8 |
| 02-threadpool-starvation | A login burst on the libuv threadpool | d2 | node, capacity | t8 |
| 03-bind-parameter-cap | Bulk INSERT and the bind-parameter cap | d2 | sql, batching | t8 |
| 04-keepalive-idle-chain | Keep-alive idle timeouts must grow inward | d2 | networking, node | t8 |
| 05-rolling-deploy-drain | Rolling deploys: the drain budget | d2 | operations, availability | t8 |

### sysdrills/16-data-access-and-integrity — Data access & integrity (5)
| 01-soft-delete-unique | Soft delete vs the unique index | d2 | sql, data-modeling | t8 |
| 02-optimistic-contention | Optimistic locking on a hot row | d2 | concurrency, transactions | t8 |
| 03-expand-contract-phases | Expand/contract: every live version, every phase | d3 | migrations, deploys | t8 |
| 04-sibling-include-explosion | Two includes, one JOIN: the row explosion | d2 | orm, sql | t8 |
| 05-backfill-pacing | Pacing a backfill so the replica keeps up | d2 | migrations, replication | t8 |

### sysdrills/17-client-data-layer — React client data layer (4)
| 01-fetch-waterfall | Nested fetches: the critical path | d2 | react, latency | t8 |
| 02-query-freshness | staleTime and gcTime: what a mount really does | d2 | react, caching | t8 |
| 03-visibility-gated-polling | Polling dashboards: rate and waste | d2 | react, load | t8 |
| 04-six-connections-per-domain | HTTP/1.1: six connections per domain | d1 | networking, browser | t8 |

### sysdrills/18-web-authz-and-sessions — Web authorization & sessions (4)
| 01-deny-overrides | Deny overrides, and nothing matched means no | d2 | authz, security | t8 |
| 02-tenant-scope-filter | Tenant scoping: one OR away from a leak | d3 | multitenancy, security | t8 |
| 03-session-idle-absolute | Sessions: idle timeout, absolute cap, store writes | d2 | sessions, security | t8 |
| 04-access-token-lifetime | Access-token lifetime: refresh load vs exposure | d2 | auth, capacity | t8 |

### sysdrills total: 129

---

## 2. Quality findings

Ranking: WRONG = violates a stated bank rule or is factually false · WEAK = teaches less than it claims or
is beatable by a naive answer · NIT = wording / polish. No wrong expected value was found: 129/129 sysdrills
pass under node; the 23 C#/Java drills read in full were re-derived where a number could be (listed below).

### WRONG

**W1. sysdrills 01-03: hint 3 is the solution, verbatim (22 drills).**
- Where: `tools/seed/authoring/sysdrills/01-estimation.json:64` (`01-qps-from-dau`, hint 3 =
  `return (dau * requestsPerUser) / 86400;`); `03-reliability-math.json:120` (`02-availability-ppm`, hint 3 =
  `const down = parts.reduce((acc, p) => (acc * (1_000_000 - p)) / 1_000_000, 1_000_000); return 1_000_000 - down;`);
  `03-reliability-math.json:377` (`06-retry-budget`, hint 3 = the whole `while` loop). All 8 + 6 + 8 drills of
  modules 01, 02, 03 have this shape (`lint.txt`); modules 04-18 do not.
- Evidence: SEEDING.md:1038, 1042-1043, 1062 state the rule for waves 2-4 and for cs/java ("hint 3 is
  approach+formula only (never pasteable code)"); the cs/java importers enforce it (SEEDING.md:181, 231), the
  sysdrills importer (`tools/seed/src/sysdrills/source.ts:58`) has `hints` optional with no content rule.
  The qw report item at SEEDING.md:1658 names only "11/07, 12/03, 14/03" (parentheses), so wave 1 was missed.
- Impact today: none for the learner — `shared/src/api.ts:387` marks hints "progressive hints (not served
  yet)". Impact the day hints ship: the third hint gives the full answer on 22 drills.
- Fix: rewrite the 22 hint 3s as prose approach (the modules 04-14 style), and add the cs/java hint-3 gate
  (`;`, `return`, `=>`, parentheses) to `tools/seed/src/sysdrills/import.ts` so it cannot recur. Content-only
  edit on an mx-era pack ("lesson and title kept", SEEDING.md:1452) — no restamp.

### WEAK

**K1. sysdrills 01-14: "Your task" hands over the formula (95 of 111 drills).**
- Where (examples): `01-estimation.json:383` (`07-littles-law`: "`concurrentRequests(qps, latencyMs)` →
  `qps × latencyMs / 1000`"); `05-sql-and-indexing.json:389` (`07-join-strategy-reads`:
  "`nestedLoopReads(...)` → `outerRows × (innerLevels + matchesPerRow)`"); `07-hashing-and-sharding.json`
  `01-modulo-vs-consistent` ("→ `totalKeys × oldShards / (oldShards + 1)`"); `10-capacity-and-cost.json:216`
  `04-autoscale-steps` ("→ `ceil(current × utilPermille ÷ targetPermille)`"). Per module (formula/total):
  01 6/8, 02 3/6, 03 6/8, 04 7/8, 05 7/8, 06 7/8, 07 8/8, 08 7/8, 09 8/8, 10 8/8, 11 6/8, 12 7/8, 13 7/8,
  14 8/9, **15-18 0/18** (`taskformula.mjs`).
- Why it matters: with the formula in the task, hint 2 (SEEDING.md:1488 convention) and, in 01-03, hint 3,
  the only thing a test can catch is a typo. The module descriptions promise "you practise the reasoning,
  not the calculator"; the task text removes the reasoning. qw did exactly this clean-up for csdrills
  (SEEDING.md:1471, "34 Your-task sections no longer contain the solution expression") but not here.
- Fix: for each of the 95, keep the *semantics* line (what the function answers, units, rounding direction)
  and move the formula to hint 2 (already there in most). The cw modules show the target shape, e.g.
  `15-node-service-runtime.json:99` `hashesPerSec(...)` → "sustained hashes per second when threads run in
  parallel but never more of them than there are cores". Rule for the importer: no `×`, `÷`, `*`, `/`,
  `ceil(`, `floor(` inside a backtick after "Your task".

**K2. sysdrills 01-14 tests are value checks that cannot distinguish a learner who reasoned from one who
typed.** Because every expected value is `f(inputs)` of a given formula, there is no "naive" variant to
catch — contrast the cw modules where each drill names a trap and a test defeats it: `18/02` test 6 ("an
AND whose only tenant part is a leaky OR") defeats the shallow "does any part mention tenantId" check;
`17/02` test 3 ("exactly staleTime old → already stale") defeats `>`; `16/02` test 2 defeats
`writers × maxAttempts`; `15/03` test 5 ("10 rows of 30 columns under a 100 cap → 4, not 300 / 100")
defeats the total-parameter division. Fix for old modules: add one "tempting wrong model" test per drill
(e.g. 01/07: a test where ms are not converted; 07/01: a test where the naive `1/oldShards` is wrong; 03/02:
a series input where "take the minimum" differs from the product).

**K3. csdrills: the Contract paragraph is pseudo-code; several drills are transcription.**
- `csdrills/10-crud-endpoint-logic.json:110` `06-etag-precondition` (d2): Contract enumerates every branch
  ("null fails closed; `*` matches any; otherwise exact, case-sensitive string equality"; "not found → 404;
  found but failed → 412; otherwise 204"); `ETagOf` is a one-line interpolation. The one real interview point
  (404 before 412, RFC 9110 §13.2.1) is stated, not discovered. The If-Match grammar that actually bites in
  a gateway — a list (`"v2", "v3"`) and weak tags (`W/"v3"` must NOT match under strong comparison) — is
  absent. Fix: keep the status mapping, make the list + weak-tag cases the trap (two tests).
- `csdrills/02-async-composition.json:53` `04-sync-throw-vs-faulted` (d3): "Your task" literally says
  "`return LoadCore(parsed);` with a nested `async Task<int> LoadCore(int value)`". The tests are good
  (test 1 catches the all-async version; test 4 proves the loader never runs), but d3 is inflated for a
  task that dictates the structure. Fix: drop the structure sentence; hint 2 already carries it.
- Same pattern at `06-text-at-the-edge.json` `03-parse-query` (Contract is the algorithm, incl. decode
  order), `07-auth-headers`, `10/05-cursor-token`, `07-hashing-and-identifiers.json` `07-stable-bucket`
  (Contract gives `h = h * 31 + ch`, `uint`, `% buckets`). In these the Contract is the solution in English;
  the drill is still worth doing but is d1 work labelled d2/d3.

**K4. javadrills "one pass" and "op order" claims that no test checks (known family, two more cases).**
- `javadrills/04-collectors.json:102` `06-teeing`: "`averageCents(List<Integer> prices)` → sum ÷ count as a
  `long`, in one pass". `prices.stream().mapToInt(x -> x).sum() / prices.size()` passes all tests; only the
  `health` half has a real trap (a single `maxBy` over all calls names `b`, caught by test 3). SEEDING.md:1655
  already lists 04/04 "one pass" as untestable; 04/06 is the same.
- `javadrills/03-streams-execution.json:121` `07-sorted-buffers-everything`: the task dictates
  "journal, `sorted()`, then `limit(2)`" / "journal, `limit(2)`, then `sorted()`" — the learner types the
  order the task gives (SEEDING.md:1654 lists it). Fix: ask for "the two smallest, touching as few elements
  as the operation allows" + "the first two, ordered" and let the journal tests decide.

**K5. Difficulty labels in sysdrills 01-14 do not track effort.** d3 items are one-line formulas once the
task is read: `03-reliability-math.json:54` `02-availability-ppm` (d3, a `reduce`), `06-concurrency.json:474`
`08-amdahl-runtime` (d3, `serial + parallel / workers`), `03/04-exponential-backoff` (d3, `min(cap, base·2^i)`),
while cw d2 items are multi-branch simulations (`16/03-expand-contract-phases` is d3 and deserves it;
`18/02-tenant-scope-filter` d3 ditto). Fix: re-label 01-14 by the number of independent decisions in the
solution (1 → d1, 2 → d2, 3+ or a recursion/loop invariant → d3).

**K6. Trivia-grade drills (low interview value).** `javadrills/09-instants-and-zones.json` `01-epoch-instants`
(d1: `Instant.parse(iso).toEpochMilli()` and `Instant.ofEpochMilli`); `csdrills/10-crud-endpoint-logic.json`
`01-page-envelope` (d1: ceiling division) next to `02-clamp-params` (d1; its one good test is the
`OffsetOf(int.MaxValue, 100)` overflow); `sysdrills/17-client-data-layer.json:416` `04-six-connections-per-domain`
(d1: `ceil(24/6)`, `max(0, 6 − streams)`) — the explanation is the valuable part, the code is not.
Candidates to fold into neighbours or retire when the next wave prunes.

### NIT

- N1. `sysdrills/03-reliability-math.json:116` (`02-availability-ppm` explanation): "Three flaky 90% copies
  **beat** one 99.9% box" — 1 − 0.1³ = 0.999 exactly; they *match* it. Say "equal".
- N2. `csdrills/06-text-at-the-edge.json:114` (`07-auth-headers` explanation): `Convert.TryFromBase64String`
  "simply answers false for junk" — it also answers false when the destination span is too small, which is
  the bug people actually hit when they adopt it. One clause.
- N3. Triple redundancy in sysdrills 01-03: task formula + hint 2 formula + hint 3 code (W1 + K1 on the same
  drill, e.g. `01-estimation.json` `01-qps-from-dau` lines 15, 63, 64).
- N4. `sysdrills` `skills` vocabulary is inconsistent across waves (01/07 `estimation, queueing` vs 06/04
  `littles-law, concurrency` vs 10/01 `capacity, cpu` for the same law), which defeats topic grouping in the
  client. A 30-term controlled list would fix it.
- N5. `csdrills/04-money-and-rounding.json:65` `05-weighted-allocation` and `javadrills/08-money-math.json:8`
  `01-weighted-allocation` are the same algorithm with the same tie rule and almost the same vectors
  ((100,[1,1,1]) → [34,33,33]); fine as a deliberate twin, but neither says so the way 06/09 ↔ 11/08 does.
- N6. `javadrills/01-collections-behavior.json` `01-three-list-factories`, `03-view-vs-copy`, `08-set-of-rules`
  and `04-collectors.json` `05-collectingandthen` teach "view vs copy vs unmodifiable" four times in a
  21-drill span; one could become `Collections.unmodifiableMap` of a mutable value (the deep/shallow trap).

### Hand recomputations (all correct)
- 01/07 `concurrentRequests(1000,200)` = 200; `maxQps(100,50)` = 2000.
- 03/02 `seriesPpm([999000,999000])` = 998,001; `parallelPpm([900000]*3)`: downtimes 100,000 → 10,000 → 1,000 → 999,000.
- 04/04 `anySlowPpm(990,3)` = 1,000,000 − 970,299 = 29,701 (≈ p97 at fan-out 3 as the explanation says).
- 10/04 `desiredInstances(10,900,600)` = 15; `minutesToScaleOut(10,40,5,5)` = 6 × 5 = 30.
- 11/09 `survivesZoneLoss(5,2)`: 5 − ceil(5/2) = 2 < floor(5/2)+1 = 3 → false.
- 14/09 `burnRateThreshold(50,6)` = 50·720/(6·1000) = 6; `budgetPermilleSpent(144,5)` = 1000.
- 15/03 `rowsPerStatement(12,65535)` = 5,461; `statementsForImport(100000,12,65535)` = ceil(18.31) = 19.
- 16/02 `totalAttempts(10,3)` = 10+9+8 = 27; `failedWriters(10,3)` = 7.
- 18/03 `sessionExpiresAt(0,28000,1800,28800)` = min(29800, 28800) = 28,800; `storeWritesPerSec(2000,60000,60)` = 1,000.
- csdrills 04/05 (101,[2,1]) → floors 67/33, remainders 1/2 → [67,34]; 07/07 "api" → 96,794 % 7 = 5,
  "user-42" → 4,147,784,640 % 7 = 6 (wrapped), "tenant-9" % 4 = 2; 05/06 2026-10-25 is a Sunday → Monday
  2026-10-19, 2026-01-01 (Thu) → 2025-12-29; 10/05 "42" → bytes 34 32 → `NDI=`; 03/04 "paid,shipped" → 1|2 = 3 = Cancelled.
- javadrills 08/06 10.00×0.9125 = 9.125 → HALF_EVEN 9.12; 9.12×1.0959 = 9.994608 → 9.99 → loss 0.01;
  10.00×0.9135 → 9.14; 9.14×1.0947 = 10.005558 → 10.01 → −0.01. 02/01 MIN_VALUE − 3 wraps to 2,147,483,645.
  09/05 Europe/Paris 2021-03-28 and 2021-10-31 are Sundays (tz data fixed). 11/07 claims about JS SameValueZero
  and C# `double.Equals`/`HashSet<double>` folding −0.0 are correct.

### What is good (so the next wave keeps it)
- Race tests in csdrills 09 are gated (`Race(8, ...)` with a `ManualResetEventSlim` and a slow factory that
  spins until a second build appears, `09-thread-safety.json` `04-getoradd-lazy`) — the GetOrAdd trap cannot
  hide. 10/04, 05/01 (java) count supplier calls; 02/04 (cs) asserts the loader never ran.
- Boundary tests are real boundaries (17/02 `age == staleTime`, 15/04 equal idle timeouts, 11/09 single zone,
  cs 01/08 "client NEWER than server", java 07/04 self-suppression).
- Explanations cite behaviour at a version ("@tanstack/query-core 5.90.2 ... `isStaleByTime`", "Node 22.16
  probe", "ALB default 60 s") and name the production remedy (stream the export, `unnest`/COPY, RLS as a
  second layer, `withTenant` wrapper).

---

## 3. Proposed new content (ranked by value)

Checked against SEEDING §8 (owned-elsewhere list at :1675-1676: cursors, If-Match, merge patch,
idempotency keys, N+1, lost updates, optimistic updates, debounce, JWT exp/nbf, CSRF) and the handoff
"Next ideas". P1 endorses handoff idea #5 with a concrete spec; the rest are new.

**P1. jsdrills bank — the missing JS/TS leg (handoff idea #5, endorsed).** Bank `jsdrills`, drill-js
(`.ts` allowed: the runner type-strips via esbuild, SEEDING.md:808). 4 modules × 6-8 drills; detailed
candidates in §4. Effort L (new importer modelled on sysdrills + `JSDRILLS_EXPECTED`, no fingerprinted
files). Highest value because the primary target is JS/TS+React and 0 of 281 authored drills run in it;
the cross-language traps (rounding, UTF-16, DST, lazy fallbacks, finally-return) already have a C# and a
Java leg each.

**P2. sysdrills 19 — Transactions & isolation (drill-js simulations).** Trap family absent from all 281:
"isolation level", "read committed", "write skew", "for update"/"skip locked", "deadlock" appear in no drill
(deadlock once in csdrills prose). CRUD interviews ask it every time.
- `lostUpdateSchedule(ops)` — interleave two read-modify-write transactions under READ COMMITTED; count
  lost increments (trap: `UPDATE ... SET n = n + 1` vs read-then-write).
- `writeSkewViolations(constraint, txns)` — two doctors on call; snapshot isolation lets both resign (trap:
  SI is not serializable).
- `deadlockPossible(lockOrders)` — detect a cycle in per-transaction lock order lists; fix = canonical order.
- `skipLockedThroughput(workers, rows, holdMs)` vs `forUpdateThroughput` — job-queue pattern; FOR UPDATE
  serialises, SKIP LOCKED parallelises.
- `idempotentUpsertRows(events)` — ON CONFLICT DO UPDATE replays: rows and versions after duplicates.
- `retryOnSerializationFailure(attempts, conflictPermille)` — expected attempts under 40001 retries.
Effort M (8 tests each, SQLite probes like cw did).

**P3. sysdrills 20 — Background jobs, leases & delivery guarantees.** "visibility timeout", "lease",
"fencing", "exactly-once", "at-least-once", "cron" appear in no drill; every CRUD app has a worker.
- `visibilityTimeoutMs(p99JobMs, marginPermille)` and `duplicateDeliveries(jobs, timeoutMs, actualMs)` — a
  timeout below the job duration redelivers it (trap: at-least-once means your handler runs twice).
- `fencingAccepts(writes)` — a stale lease holder writing with a lower token is refused.
- `leaseRenewDeadlineMs(leaseMs, rttMs)` — renew before lease − 2·RTT or lose the lock while you think you
  hold it.
- `dedupStoreEntries(qps, windowSec)` — idempotency store size for an at-least-once consumer.
- `cronMissedRuns(schedule, downtimeWindow)` and `catchUpPolicy` — one run or all missed runs?
- `outboxRelayLagSec(writeQps, relayBatch, relayIntervalMs)` — the visible delay of the outbox pattern.
Effort M.

**P4. csdrills 11 — LINQ execution semantics & IEnumerable contracts.** No drill in any bank covers
deferred execution, multiple enumeration, or `IQueryable` vs `IEnumerable` (keyword scan: 0 hits), and it is
the #1 .NET code-review finding in CRUD services. Console-check friendly (counting enumerators, no EF).
- `CountedSource` + `Where(...)` enumerated twice → the source is read twice (trap: deferred execution).
- `Select` with a side effect (`i++`) under `Any()` — only as many as needed run (short-circuit).
- `ToList()` placement — materialise once before fan-out; test counts enumerations.
- `yield return` iterator with a `try/finally` — finally runs on early `break` via `Dispose`.
- `OrderBy(...).ThenBy(...)` vs two `OrderBy` calls (the second replaces the first; stability).
- `GroupBy` vs `ToLookup` (deferred vs immediate; missing key → empty sequence, not exception).
- `AsQueryable()` expression tree vs delegate: `Where(x => Helper(x))` cannot translate — model with a tiny
  visitor that refuses non-member-access predicates.
Effort M.

**P5. csdrills 12 — System.Text.Json at the API boundary.** BCL-only, so it runs in the console-check
harness; CRUD-API interviews probe it; csdrills 03/05 `wire-names` touches it from the enum side only.
- camelCase policy and case-insensitive reads; a property that silently stays default on a typo
  (`JsonUnmappedMemberHandling.Disallow`).
- Enums as strings (`JsonStringEnumConverter`) and the integer-fallback trap (`99` deserialises).
- `DateTime` round-trip: `Kind=Unspecified` loses the offset; `DateTimeOffset` keeps it (pairs with 05/08).
- `decimal` precision and `long` beyond 2^53 as string (`JsonNumberHandling.WriteAsString`) — pairs with 10/05.
- `required`/`init` members and nullable reference annotations: what a missing field does.
- Polymorphic `[JsonDerivedType]` discriminator and the unknown-discriminator failure mode.
Effort M.

**P6. javadrills 12 — Concurrent collection contracts (the Java twin of csdrills 09).** javadrills has no
concurrency module; javabootcamp 17 is deterministic concurrency (clocks, seeded Random) and does not own
these contracts (jb 17/06 is `exceptionally`). Gated-thread tests like csdrills 09.
- `ConcurrentHashMap.computeIfAbsent` runs the mapping once under contention (vs `get`-then-`put`), and
  must not modify the map recursively (`IllegalStateException`).
- `putIfAbsent(k, expensive())` is eager; `computeIfAbsent` is lazy (the collection-side twin of 05/01).
- `AtomicInteger.incrementAndGet` vs `count++` under 8 gated threads (twin of cs 09/01).
- `CopyOnWriteArrayList` iteration is a snapshot: adds during iteration are not seen, no CME.
- `Collections.synchronizedList` needs the client lock around iteration (`synchronized (list)`).
- `ConcurrentHashMap.merge` for a tally (twin of cs 09/03 `AddOrUpdate`).
Effort M.

**P7. javadrills 13 — Screening traps the bank still lacks** (check javabootcamp first; the ones below are
not in the javadrills topic map). `Integer` cache `==` (127 vs 128); `Arrays.asList(int[])` → `List<int[]>`;
`Collectors.toMap` duplicate key → `IllegalStateException` and the merge-function fix (the most common
collector trap, absent from module 04); `String.split("|")`/`split(".")` regex and dropped trailing empties;
`Math.round(-2.5)` = −2 vs `RoundingMode.HALF_UP` (fits 08-money); `LocalDate.plusMonths` end-of-month clamp
(Java twin of csdrills 05/04, absent from 09); `Enum.valueOf` throws vs a safe parser (twin of cs 03/04,
fits module 11). Effort S-M (6-7 drills).

**P8. csdrills 13 — Cancellation & disposal.** Only 09/10 touches `CancellationToken`. Drills:
`CancellationTokenSource.CreateLinkedTokenSource` + timeout; cooperative cancellation inside a loop
(`ThrowIfCancellationRequested` placement, test counts iterations); `OperationCanceledException` vs
`TaskCanceledException` and `Task.IsCanceled`; `Dispose` idempotency and `using` ordering (LIFO);
`IAsyncDisposable`/`await using` ordering; `IAsyncEnumerable<T>` with `WithCancellation` and `yield` in a
`try/finally`. Effort M.

**P9. sysdrills 21 — HTTP caching for GET (conditional GET, CDN, Vary).** The bootforge is-fresh drill checks
one TTL (per the 17/02 explanation); nothing covers `Cache-Control` state machines or CDN economics.
`cacheState(ageSec, maxAge, swr)` → fresh / stale-while-revalidate / expired; `originQps(edgeQps,
hitPermille)`; `varyCardinality(headers)` (a `Vary: Cookie` that kills the hit rate); `conditionalGetSavedBytes`
(304 on `If-None-Match`); `purgeFanout(objects, pops)`. Effort S (5 drills).

**P10. Fixes before features (cheap, high leverage):** W1 (22 hint 3s), K1 (95 task formulas, scriptable:
move the backticked formula into hint 2 when hint 2 lacks it, otherwise delete), the two importer gates
(hint 3 content; task-line arithmetic), K5 relabel. Effort S-M, content-only, no restamp.

Dropped as already owned or already listed: cursors/keyset, If-Match, merge patch, idempotency keys, N+1,
lost updates on the client, optimistic UI, debounce, JWT exp/nbf, CSRF (SEEDING.md:1675-1676); typeahead
load and login-lockout math (C1 dropped, :1729); set-B retakes, EB leak lint, hint-2 thinning, classic JS
EBs, quiz layers (handoff ideas 1-4, 6).

---

## 4. jsdrills candidates (15, each a trap with a C# and/or Java leg today and no JS leg)

| # | Drill (module) | Trap it teaches | Siblings |
|---|---|---|---|
| 1 | `setMonth` overflows (01-time) | `new Date(2026,0,31).setMonth(1)` → Mar 3: JS *overflows* where .NET/Java *clamp*; write `addMonthsClamped`. | cs 05/04 |
| 2 | Week start with `getDay()` (01-time) | Sunday = 0 again; `(d.getDay() + 6) % 7`; UTC vs local `getDay`. | cs 05/06 |
| 3 | Calendar day vs 24 h across DST (01-time) | `setDate(d+1)` keeps the wall clock, `+86_400_000` drifts; `Intl.DateTimeFormat` with `timeZone` to read a zone without Temporal. | cs 05/09, java 09/05 |
| 4 | UTC day key cross-midnight (01-time) | `toISOString().slice(0,10)` vs `getDate()`; hour bucket `Math.floor(ms/3.6e6)*3.6e6`. | cs 05/03, java 09/06 |
| 5 | Seconds vs milliseconds and 2^53 ids (01-time) | `new Date(1767225600)` is 1970; `Number.MAX_SAFE_INTEGER`; ids as `string`/`BigInt`. | cs 05/01, 10/05, java 09/01 |
| 6 | Half-up vs bankers, `Math.round(-2.5)` (02-money) | `Math.round` rounds half toward +infinity (−2); `toFixed(2)` is binary-float rounding (`1.005.toFixed(2)` = "1.00"); integer cents. | cs 04/02, java 11/01 |
| 7 | Largest-remainder allocation in integer cents (02-money) | `0.1 + 0.2`; floor shares, hand out the remainder, deterministic tie. | cs 04/05, java 08/01 |
| 8 | UTF-16 length vs code points vs UTF-8 bytes (03-text) | `"🙂".length === 2`; `Array.from(s)`, `codePointAt`, `TextEncoder().encode(s).length`; truncate to a byte budget without splitting a pair. | cs 06/09, java 06/04, 11/08 |
| 9 | NaN, −0 and SameValueZero (03-text/numbers) | `[NaN].includes(NaN)` true, `indexOf` −1; `Object.is(0,-0)` false but `Set` folds them; default `sort()` is lexicographic (`[10,9,1]`). | java 11/07, 02/03, 02/01 |
| 10 | Query string: `+`, `%2B`, duplicates (03-text) | `URLSearchParams` decodes `+` as space, `getAll` vs `get` last/first; `encodeURIComponent` leaves `!*()` and the apostrophe unescaped. | cs 06/02, 06/03 |
| 11 | Stable hash across processes (03-text) | No built-in string hash; FNV-1a with `Math.imul` and `>>> 0` for unsigned wrap; `%` on a negative. | cs 07/07 |
| 12 | Memoize the Promise, not the value (04-async) | Cache the in-flight promise to kill the stampede; delete the entry on rejection so one failure is not cached forever. | cs 02/02, 09/04 |
| 13 | `async` never throws synchronously (04-async) | Validate in a non-async wrapper so bad arguments throw at the call; the rejected promise otherwise surfaces late or as an unhandled rejection. | cs 02/04 |
| 14 | `??` vs `\|\|` and lazy fallbacks (04-async) | `0` and the empty string are falsy; `x ?? build()` is lazy but `f(x \|\| build())` is eager; thunk the expensive default. | java 05/01, 10/04 |
| 15 | `finally` that returns, and the cleanup that hides the error (04-async) | `return` in `finally` swallows the pending throw; a throwing cleanup replaces the body error — keep the primary (`new Error(msg, { cause })`, `AggregateError`). | java 07/09, 07/04, 07/03 |

Also worth a slot if the bank grows: `Promise.all` vs `allSettled` vs `any` (java 10/09, cs 02/03); the
await-gap lost update (`n = await get(); await set(n+1)` — the single-threaded twin of cs 09/01-02);
TS numeric-enum reverse mapping (`Status[99]`, twin of cs 03/04); bitmask flags with `1 << 31` going
negative (cs 03/02-07); LRU with `Map` insertion order (cs 08/01); token bucket with an injected clock
(cs 08/05).

---

## 5. Duplicates and near-duplicates

Cross-bank twins (same trap, same algorithm, different language) — acceptable when declared, as 06/09 ↔ 11/08
is; the rest are not declared:
- csdrills 04/05 `weighted-allocation` = javadrills 08/01 `weighted-allocation` (same rule, same tie-break,
  shared vector (100,[1,1,1]) → [34,33,33]). `csdrills/04-money-and-rounding.json:65`, `javadrills/08-money-math.json:8`.
- csdrills 05/09 `dst-wall-clock` is a superset of javadrills 09/05 `dst-day` (the C# adds the gap/overlap policy).
- csdrills 05/03 `utc-buckets` ≈ javadrills 09/06 `truncation-buckets`; csdrills 05/01 `epoch-roundtrip` is a
  superset of javadrills 09/01 `epoch-instants`.
- csdrills 04/02 `midpoint-rounding` ≈ javadrills 11/01 `rounding-mode`; csdrills 04/03 `vat-in-cents` ≈
  javadrills 08/03 `basis-points` (both `(x·r + half) / divisor` half-up; Java adds `grossUp`).
- csdrills 08/05 `token-bucket` (class with injected clock) ≈ sysdrills 02/05 `token-bucket` (pure
  `min(burst, tokens + rate·elapsed)`), `csdrills/08-service-data-structures.json:90`,
  `sysdrills/02-caching-and-pools.json:267` — same clamp trap.
- csdrills 06/09 ≈ javadrills 11/08 (declared twin) and javadrills 06/04 `codepoints` overlaps 11/08 on
  surrogate pairs inside the same bank.

Within sysdrills (same formula re-skinned):
- Little law × 4: 01/07 `concurrentRequests = qps·ms/1000` and 06/04 `workersNeeded = jobsPerSec·ms/1000`
  are the same two functions with renamed parameters (both also give the inverse); 10/01 `coresBusy` and
  02/03 `poolSize` are the same product with a headroom factor. Keep 06/04 (worker pool, the interview
  framing) and 02/03 (the float trap is real); 01/07 and the first half of 10/01 are redundant.
- 03/02 `availability-ppm` = 04/04 `tail-at-fanout` (same product in ppm; the 04/04 explanation at
  `04-networking-and-latency.json:318` admits "the same multiplication as 03/02").
- Error-budget arithmetic × 4: 03/03 (minutes/month), 14/04 (burn × → hours), 14/09 (budget share → burn ×,
  explicitly the inverse of 14/04), 12/04 (one incident share). 14/04 is subsumed by 14/09.
- Surplus-rate drain × 3: 06/01 `drainSeconds = backlog/(process − arrive)`, 09/03 `consumersToDrain`,
  11/07 `breachSeconds = headroom/(write − replay)` (06/01 with the sign flipped).
- Bytes = count × size, nodes = ceil(bytes/node) × 3: 01/05 `nodesNeeded`, 13/08 `vectorNodesNeeded`
  (identical shape), 05/08 `indexBytes`; and storage/bandwidth sizing × 6: 01/03, 08/03, 10/02, 10/06,
  01/04, 04/07 (01/04 and 04/07 are inverses).
- Retry families: 03/06 `retry-budget` vs 04/05 `retries-within-deadline` (tries that fit a deadline,
  exponential vs constant backoff); 06/07 `retry-storm` is 09/04 `retry-amplification` at depth 1.
- Quorum: `r + w > n` appears in 03/01, 03/08 and (as `n − w + 1`) 11/01.

Within csdrills / javadrills (same lesson, different API):
- csdrills 02/02 `memoize-the-task` ≈ 09/04 `getoradd-lazy` ("build once under concurrent first calls":
  Task vs `Lazy<T>`); worth keeping both because the race test in 09/04 is the stronger one.
- javadrills 05/01 `orelse-vs-orelseget` ≈ 10/04 `fallback-service` (laziness of the fallback; the 10/04
  explanation says so); javadrills 01/01, 01/03, 01/08, 04/05 (view / copy / unmodifiable, see N6).
- csdrills 10/01 `page-envelope` and 10/02 `clamp-params` are two d1 paging drills; sysdrills 05/05
  `offset-pagination-cost` is the cost side of the same topic (not a duplicate, a good triad).

Suggested consolidation (next pruning wave): retire or merge 01/07 into 06/04, 14/04 into 14/09, the
01/05 `nodesNeeded` half into 13/08, 04/07 into 01/04; declare the five cs/java twins in their descriptions
the way 06/09 ↔ 11/08 does. Net −4 sysdrills, census 129 → 125 (update `SYSDRILLS_EXPECTED` and the
ladder pins).

---

Scratch artefacts (same folder): `topicmap.md` (generated map), `lint.txt` (hint-3 code-likeness and task
formulas per drill), `recompute.mjs` (runs all 129 sysdrills solutions/starters), `taskformula.mjs`,
`pairs.mjs` (duplicate-candidate briefs), `cover.mjs` (keyword coverage scan).