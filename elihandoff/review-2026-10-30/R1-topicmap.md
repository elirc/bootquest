
## csdrills/01-linq-set-reconciliation — LINQ set ops & list reconciliation (8)
| 01-sync-added-removed | Sync a tag list: added and removed | d2 | Except, reconciliation | t5 |
| 02-kept-and-same | Kept items and "did anything change?" | d2 | Intersect, SequenceEqual | t6 |
| 03-dedupe-by-key | Dedupe signups by canonical email | d2 | DistinctBy, canonical keys | t5 |
| 04-batch-membership | Validate a batch of ids in one pass | d1 | ToHashSet, lookup cost | t5 |
| 05-minby-maxby | Cheapest plan and price spread | d1 | MinBy, MaxBy | t5 |
| 06-zip-pairing | Zip two parallel columns into labels | d1 | Zip, silent truncation | t4 |
| 07-any-all-vacuous | Any/All on empty collections | d1 | Any/All, vacuous truth | t6 |
| 08-version-reconcile | Client cache sync by id and version | d2 | keyed diff, cache sync | t6 |

## csdrills/02-async-composition — Async composition without the clock (7)
| 02-memoize-the-task | Memoize the Task, not the result | d2 | task caching, stampede prevention | t4 |
| 03-whenany-first-wins | First replica to answer wins | d2 | WhenAny, hedged reads | t6 |
| 04-sync-throw-vs-faulted | Validate eagerly: throw before the Task | d3 | eager validation, async local functions | t4 |
| 05-sequential-pipeline | Strictly one at a time, in order | d2 | ordered awaits, sequential pipelines | t5 |
| 06-tcs-bridge | Bridge a callback into a Task | d2 | TaskCompletionSource, callback bridging | t4 |
| 07-try-load-funnel | Catch the expected failure only | d2 | expected vs unexpected failure, selective catch | t4 |
| 08-task-status-snapshot | Health endpoint: describe a Task | d1 | TaskStatus flags, terminal states | t4 |

## csdrills/03-enums-and-flags — Enums, flags & permission masks (7)
| 02-revoke-and-toggle | Revoke and toggle rights | d2 | and-not, xor | t6 |
| 03-any-vs-all-mask | Any-of vs all-of mask checks | d2 | mask semantics, vacuous empty mask | t7 |
| 04-parse-status-safely | Parse a status safely (the TryParse("99") trap) | d2 | Enum.TryParse, Enum.IsDefined | t8 |
| 05-wire-names | Stable wire names for an enum | d1 | stable string contract, dictionary mapping | t5 |
| 06-flags-to-names | Render a mask as its right names | d2 | decomposition, declaration order | t4 |
| 07-count-and-single | Count rights; is it exactly one? | d2 | popcount, power of two | t6 |
| 08-role-matrix | Effective permissions from roles | d3 | composition, fail closed | t6 |

## csdrills/04-money-and-rounding — Money, decimal & rounding (5)
| 01-cents-roundtrip | Store money as integer cents | d1 | decimal to cents, exact conversion | t6 |
| 02-midpoint-rounding | Banker's rounding vs half-up | d2 | MidpointRounding, invoice rounding | t5 |
| 03-vat-in-cents | VAT in integer cents, half-up | d2 | integer rounding, tax math | t6 |
| 05-weighted-allocation | Weighted split: largest remainder | d3 | largest remainder, proportional allocation | t5 |
| 07-strict-money-parse | Strict money parsing (the 100× bug) | d2 | NumberStyles, input validation | t7 |

## csdrills/05-time-and-scheduling — Instants, buckets & calendars (8)
| 01-epoch-roundtrip | Unix seconds round-trip | d1 | Unix time, instants vs offsets | t7 |
| 03-utc-buckets | UTC hour and day buckets | d2 | UTC bucketing, cross-midnight trap | t5 |
| 04-add-months-clamp | Billing anniversaries: AddMonths clamp and drift | d3 | AddMonths clamping, end-of-month policy | t6 |
| 05-booking-overlap | Booking overlap with half-open stays | d2 | half-open ranges, overlap test | t8 |
| 06-week-start | ISO week start (Monday) from any date | d2 | DayOfWeek arithmetic, enum-zero trap | t4 |
| 07-grace-and-gaps | Whole days between, and grace windows | d1 | duration comparisons, inclusive deadlines | t5 |
| 08-kind-hygiene | DateTimeKind hygiene at the database edge | d2 | DateTimeKind, SpecifyKind vs ToUniversalTime | t5 |
| 09-dst-wall-clock | DST wall clock: a day is not 24 hours | d3 | TimeZoneInfo, DST gap and overlap, calendar day vs elapsed time | t7 |

## csdrills/06-text-at-the-edge — Strings at the API edge (8)
| 02-build-query | Build a query string | d2 | query composition, percent-encoding | t5 |
| 03-parse-query | Parse a query string tolerantly | d3 | tolerant parsing, plus vs %2B | t5 |
| 04-mask-pii | Mask PII before it reaches the logs | d1 | masking, index slicing | t5 |
| 05-route-template | Fill a route template | d2 | token filling, fail loudly | t4 |
| 06-link-header | Pagination Link header | d2 | pagination envelope, RFC 8288 Link | t4 |
| 07-auth-headers | Parse Bearer and Basic auth headers | d3 | header parsing, never throw at the edge | t8 |
| 08-clean-input | Normalize whitespace in user input | d1 | normalization, whitespace runs | t5 |
| 09-utf8-byte-budget | Truncate to a UTF-8 byte budget | d2 | UTF-8 byte counts, System.Text.Rune, surrogate pairs | t8 |

## csdrills/07-hashing-and-identifiers — Hashes, encodings & identifiers (6)
| 01-utf8-base64 | UTF-8 text to Base64 and back | d1 | Convert.ToBase64String, Encoding.UTF8 | t5 |
| 02-base64url | Base64Url: the URL-safe alphabet | d2 | Base64Url, padding | t6 |
| 03-sha256-hex | SHA-256 as lowercase hex | d2 | SHA256.HashData, lowercase hex | t4 |
| 04-idempotency-key | Idempotency key from a canonical request | d2 | canonicalization, request hashing | t4 |
| 06-luhn | The Luhn checksum | d2 | checksum, right-to-left digits | t7 |
| 07-stable-bucket | Stable bucket hashing | d2 | persistable hashing, unsigned overflow | t6 |

## csdrills/08-service-data-structures — Build the structure: caches, buffers, counters (6)
| 01-lru-cache | LRU cache | d3 | LRU eviction, dictionary + linked list | t6 |
| 02-ring-buffer | Ring buffer of recent items | d2 | ring buffer, bounded history | t5 |
| 03-top-k | Top-K events with deterministic ties | d2 | counting, deterministic tie-break | t4 |
| 04-sliding-window | Sliding-window rate counter | d3 | sliding window, injected time | t5 |
| 05-token-bucket | Token bucket | d3 | token bucket, injected time | t5 |
| 07-undo-redo | Undo / redo history | d2 | two stacks, branch-point rule | t6 |

## csdrills/09-thread-safety — Shared state & thread safety (9)
| 01-interlocked-counter | Interlocked hit counter | d2 | Interlocked, lost updates | t4 |
| 02-lock-check-then-act | Lock around check-then-act | d2 | lock, check-then-act race | t4 |
| 03-concurrent-tally | Concurrent tally with AddOrUpdate | d2 | ConcurrentDictionary.AddOrUpdate, atomic update | t4 |
| 04-getoradd-lazy | GetOrAdd + Lazy: build it exactly once | d3 | GetOrAdd race, Lazy<T> wrap | t4 |
| 05-defensive-snapshot | Defensive snapshots | d2 | copy-out, aliasing | t4 |
| 07-atomic-reload | Atomic config reload by reference swap | d2 | reference swap, immutable snapshot | t4 |
| 08-drain-the-queue | Drain a concurrent queue | d2 | ConcurrentQueue, order-agnostic asserts | t4 |
| 09-bounded-channel-inbox | Bounded inbox with Channel<T>: backpressure | d2 | System.Threading.Channels, backpressure, BoundedChannelFullMode | t6 |
| 10-async-concurrency-limiter | Async concurrency limiter with SemaphoreSlim | d3 | SemaphoreSlim.WaitAsync, try/finally release, cancellation | t5 |

## csdrills/10-crud-endpoint-logic — List-endpoint & write-endpoint logic (8)
| 01-page-envelope | Page envelope: totalPages and hasNext | d1 | ceiling division, paging contracts | t8 |
| 02-clamp-params | Clamp paging parameters | d1 | defensive defaults, offset math | t8 |
| 03-sort-whitelist | Sort through a whitelist | d2 | injection-proof sorting, direction prefix | t6 |
| 04-optional-filters | Optional filters: null means not sent | d2 | nullable criteria, conjunction | t6 |
| 05-cursor-token | Opaque cursor tokens | d2 | opaque cursors, never throw at the edge | t7 |
| 06-etag-precondition | ETag and If-Match preconditions | d2 | optimistic concurrency, HTTP 412 | t8 |
| 08-merge-patch | JSON merge patch on a dictionary | d3 | RFC 7386 merge patch, null deletes | t5 |
| 09-conditional-create | Conditional PUT: If-None-Match * and If-Match | d2 | HTTP preconditions, create-only PUT, 412 Precondition Failed | t7 |

### csdrills total: 72

## javadrills/01-collections-behavior — Collections: views, copies and contracts (8)
| 01-three-list-factories | Three ways to make a list | d1 | List, immutability | t5 |
| 02-sublist-window | A window, not a copy | d2 | List, views | t5 |
| 03-view-vs-copy | The read-only view that kept changing | d1 | List, immutability | t5 |
| 04-first-seen-order | Counts in first-seen order | d2 | LinkedHashMap, ordering | t4 |
| 05-peek-vs-insert | Looking without touching | d2 | Map, side effects | t4 |
| 06-priority-poll | Heap order is poll order | d2 | PriorityQueue | t5 |
| 07-floor-tier | Which tier is this score? | d2 | TreeMap, NavigableMap | t5 |
| 08-set-of-rules | The set that refused a duplicate | d1 | Set, immutability | t5 |

## javadrills/02-equality-and-ordering — Equality, hashing and ordering contracts (9)
| 01-overflow-safe-comparator | The comparator that overflowed | d2 | Comparator, overflow | t4 |
| 02-treeset-tiebreak | The word the TreeSet ate | d2 | TreeSet, comparator vs equals | t4 |
| 03-numeric-ids | Why 10 sorted before 9 | d1 | ordering | t4 |
| 04-case-insensitive-key | Equal tags, different buckets | d2 | equals/hashCode | t6 |
| 05-arrays-make-bad-keys | Arrays make bad keys | d2 | arrays, equality | t4 |
| 06-objects-null-safety | Null-safe by helper | d1 | Objects | t5 |
| 07-stable-sort-promise | The sort that kept its promise | d2 | sorting, stability | t5 |
| 08-record-with-array | The record that forgot its contents | d3 | records, equality | t7 |
| 09-mutable-hashmap-key | The key that vanished | d2 | HashMap, hashCode, mutable keys | t5 |

## javadrills/03-streams-execution — Streams: when does the work happen (8)
| 01-lazy-until-terminal | Nothing happens until you ask | d2 | streams, laziness | t4 |
| 02-short-circuit | The search that stopped early | d2 | streams, findFirst | t4 |
| 03-one-shot-streams | A stream is used up | d1 | streams | t4 |
| 04-infinite-to-finite | Cutting an endless stream | d2 | Stream.iterate, limit/takeWhile | t4 |
| 05-indexed-stream | Streams with an index | d1 | IntStream | t4 |
| 06-distinct-uses-equals | What distinct thinks is a duplicate | d2 | distinct, records | t5 |
| 07-sorted-buffers-everything | The limit that did not save any work | d2 | streams, stateful ops | t4 |
| 08-flatten | Splicing streams together | d2 | flatMap | t4 |

## javadrills/04-collectors — Collectors beyond toList (8)
| 01-joining | Joining with a frame | d1 | Collectors.joining | t4 |
| 02-counting-downstream | How many of each length | d2 | groupingBy, counting | t5 |
| 03-mapping-downstream | Names by department | d2 | groupingBy, mapping | t4 |
| 04-summarizing | Four statistics, one pass | d2 | IntSummaryStatistics | t4 |
| 05-collectingandthen | Collect, then freeze | d2 | Collectors.collectingAndThen, immutability | t6 |
| 06-teeing | Two collectors, one pass | d2 | Collectors.teeing | t6 |
| 07-tocollection | Let the collection choose | d1 | Collectors.toCollection | t4 |
| 08-flatmapping-filtering | Filter inside the bucket | d3 | downstream composition | t4 |

## javadrills/05-optional-discipline — Optional as an API, not a null wrapper (5)
| 01-orelse-vs-orelseget | The fallback that was never needed | d2 | Optional, lazy evaluation | t6 |
| 03-ifpresentorelse | Two branches, one call | d1 | Optional, side effects | t4 |
| 04-orelsethrow | Fail loudly, with the id | d2 | Optional, exceptions | t4 |
| 05-optional-stream | Drop the gaps | d1 | Optional, streams | t4 |
| 08-flatten-nested | Optional inside Optional | d2 | Optional, flatMap, lazy evaluation | t5 |

## javadrills/06-strings-and-text — Strings: the methods behind the traps (8)
| 01-strip-vs-trim | The space that trim could not see | d2 | whitespace, String.strip | t5 |
| 02-lines-and-blank | Lines, every flavour of them | d2 | String.lines, String.isBlank | t6 |
| 03-stringbuilder-editing | Editing a card number in place | d2 | StringBuilder | t6 |
| 04-codepoints | The emoji that counted as two | d3 | surrogate pairs, code points | t4 |
| 05-join | Joining without the trailing slash | d1 | String.join | t5 |
| 06-index-windows | Slicing by anchors | d2 | indexOf, substring | t6 |
| 07-chars-pipeline | A string as a stream of ints | d2 | String.chars, IntStream | t5 |
| 08-replace-vs-replaceall | The dot that matched everything | d2 | String.replace, regex | t5 |

## javadrills/07-exception-flow — Exceptions: the control flow you must predict (8)
| 01-finally-always | The audit line that always lands | d1 | try/finally | t4 |
| 02-catch-order | Which catch wins | d2 | multi-catch, exception hierarchy | t5 |
| 03-root-cause | What actually started it | d2 | cause chains | t5 |
| 04-keep-the-primary | The cleanup that hid the real error | d3 | suppressed exceptions | t6 |
| 05-requirenonnull | Guard clauses at the door | d1 | Objects, guard clauses | t5 |
| 07-data-carrying-exception | An exception the catcher can read | d2 | custom exceptions, unchecked | t4 |
| 08-rethrow-same | Log it or handle it, not both | d2 | rethrow discipline | t4 |
| 09-finally-traps | The finally that ate the exception | d2 | try/finally, return semantics | t5 |

## javadrills/08-money-math — Money: integer cents and BigDecimal discipline (6)
| 01-weighted-allocation | Splitting a dollar by weight | d3 | allocation, largest remainder | t5 |
| 02-line-vs-invoice-rounding | The cent the invoice disagreed on | d2 | rounding policy, reconciliation | t5 |
| 03-basis-points | Thirty basis points of a payment | d2 | basis points, integer rounding | t7 |
| 06-cross-rate | The round trip that moved a cent | d3 | BigDecimal, HALF_EVEN | t5 |
| 07-installments | Who pays the odd cent | d1 | installments, remainder policy | t6 |
| 08-discount-order | Ten percent, then five dollars — or the other way | d2 | discounts, policy order | t8 |

## javadrills/09-instants-and-zones — Instants, offsets and zones (8)
| 01-epoch-instants | A moment as a number | d1 | Instant, epoch millis | t5 |
| 02-duration-between | How late is the ticket | d2 | Duration | t5 |
| 03-wall-clock-is-not-a-moment | Nine o'clock where | d2 | LocalDateTime, ZoneOffset | t5 |
| 04-same-instant-vs-same-local | Same meeting or same clock face | d2 | ZonedDateTime, zone conversion | t5 |
| 05-dst-day | The day with 23 hours | d3 | DST, Period vs Duration | t5 |
| 06-truncation-buckets | Bucketing events by the hour | d2 | Instant, truncation | t5 |
| 07-compare-across-zones | Which call happened first | d2 | ZonedDateTime, ordering | t6 |
| 08-epoch-day-boundaries | The last millisecond of the day | d2 | LocalDate, epoch millis | t5 |

## javadrills/10-completablefuture-composition — CompletableFuture without threads (9)
| 01-thenapply-vs-thencompose | The future inside a future | d2 | CompletableFuture, thenApply vs thenCompose | t5 |
| 03-handle-both-paths | One stage for success and failure | d2 | CompletableFuture.handle | t5 |
| 04-fallback-service | Only call the backup when needed | d3 | exceptionallyCompose, laziness | t4 |
| 05-promise-contract | The first completion wins | d2 | CompletableFuture.complete, getNow | t4 |
| 06-failure-skips-stages | The stage that never ran | d2 | CompletableFuture, failure propagation | t7 |
| 07-stage-kinds | Apply, accept, run | d1 | CompletableFuture, stage kinds | t4 |
| 08-compose-and-copy | A summary nobody can change | d2 | CompletableFuture, immutability | t5 |
| 09-settle-all | Every answer, even the failures | d3 | CompletableFuture.allOf, handle | t6 |
| 10-whencomplete-vs-handle | Watch it or change it | d2 | CompletableFuture.whenComplete, handle | t5 |

## javadrills/11-cross-language-bugs — Cross-language traps (3)
| 01-rounding-mode | Half-even vs half-up on negative money | d2 | rounding modes, BigDecimal | t7 |
| 07-double-equality-traps | The reading that never equals itself | d2 | double, NaN, equality | t7 |
| 08-utf8-byte-budget | Truncate to a byte budget | d2 | UTF-8, code points | t7 |

### javadrills total: 80

## sysdrills/01-estimation — Estimation: traffic, storage & cost (8)
| 01-qps-from-dau | Average QPS from daily active users | d1 | estimation, traffic | t5 |
| 02-peak-qps | Peak QPS and the busiest hour | d1 | estimation, traffic | t5 |
| 03-storage-growth | Storage growth per day and per year | d1 | estimation, storage | t5 |
| 04-bandwidth-budget | Egress bandwidth in bytes/s and Mbps | d1 | estimation, bandwidth | t5 |
| 05-cache-working-set | Cache working set and node count | d2 | estimation, caching | t5 |
| 06-cost-per-month | Monthly fleet cost in cents | d2 | estimation, cost | t5 |
| 07-littles-law | Little's law: requests in flight | d1 | estimation, queueing | t5 |
| 08-latency-budget | What is left of the p99 latency budget | d1 | estimation, latency | t5 |

## sysdrills/02-caching-and-pools — Caching, pools & limits (6)
| 01-effective-latency | Effective latency and database load behind a cache | d2 | caching, latency | t5 |
| 02-lru-capacity | LRU capacity and evictions per hour | d2 | caching, capacity | t5 |
| 03-connection-pool | Connection pool size with headroom | d2 | capacity, queueing, databases | t5 |
| 04-rate-limit-window | Fixed-window rate limiting | d2 | rate-limiting | t5 |
| 05-token-bucket | Token bucket: refill, cap and admit | d2 | rate-limiting | t5 |
| 06-shard-count | Shard count: storage-bound or write-bound | d2 | sharding, capacity | t4 |

## sysdrills/03-reliability-math — Reliability math: quorums, availability & retries (8)
| 01-quorum-check | Read/write quorums | d2 | replication, consistency | t4 |
| 02-availability-ppm | Availability in series and in parallel (ppm) | d3 | availability | t5 |
| 03-error-budget | Error budget: downtime allowed per month | d2 | availability, slo | t5 |
| 04-exponential-backoff | Capped exponential backoff | d3 | retries, resilience | t5 |
| 05-jitter-bounds | Full and equal jitter bounds | d3 | retries, resilience | t5 |
| 06-retry-budget | Worst-case time of a retry policy | d3 | retries, latency | t5 |
| 07-mtbf-availability | Availability from MTBF and MTTR | d3 | availability | t5 |
| 08-replication-staleness | How stale can a replicated read be? | d3 | replication, consistency | t5 |

## sysdrills/04-networking-and-latency — Networking & latency math (8)
| 01-rtt-to-first-byte | Round trips before the first byte | d1 | networking, latency | t6 |
| 02-bandwidth-delay-product | Bandwidth-delay product and the window cap | d2 | networking, throughput | t6 |
| 03-nearest-rank-percentile | p50 and p99 by nearest rank | d2 | latency, percentiles | t6 |
| 04-tail-at-fanout | Tail latency at fan-out | d3 | latency, percentiles | t8 |
| 05-retries-within-deadline | How many tries fit in the deadline | d2 | timeouts, retries | t6 |
| 06-timeout-cascade | Timeout budgets down a call chain | d2 | timeouts, architecture | t5 |
| 07-payload-transfer-time | Payload time on the wire | d1 | networking, bandwidth | t5 |
| 08-latency-slo-budget | A latency SLO as a request budget | d2 | slo, percentiles | t5 |

## sysdrills/05-sql-and-indexing — SQL & indexing math (8)
| 01-selectivity | Selectivity: is this column worth an index? | d1 | sql, indexing | t5 |
| 02-rows-examined-vs-returned | Rows examined vs rows returned | d2 | sql, indexing | t5 |
| 03-btree-depth | B-tree depth and page reads per lookup | d2 | indexing, storage | t6 |
| 04-covering-index | What a covering index saves | d2 | indexing, io | t5 |
| 05-offset-pagination-cost | What OFFSET pagination really scans | d1 | sql, pagination | t5 |
| 06-index-write-amplification | What every index costs on writes | d1 | indexing, writes | t5 |
| 07-join-strategy-reads | Nested-loop or hash join? | d3 | sql, joins | t5 |
| 08-index-memory-fit | When the index outgrows RAM | d2 | indexing, capacity | t5 |

## sysdrills/06-concurrency-and-throughput — Concurrency & throughput math (8)
| 01-queue-drain-time | Queue drain time and backlog projection | d1 | queues, throughput | t6 |
| 02-utilisation-headroom | Utilisation and servers for a target | d1 | capacity, throughput | t5 |
| 03-lock-serialization | One lock caps the whole fleet | d2 | concurrency, locks | t5 |
| 04-littles-law-worker-pool | Little's law: sizing a worker pool | d2 | littles-law, concurrency | t5 |
| 05-batching-amortization | Batching amortizes the fixed cost | d2 | batching, throughput | t6 |
| 06-pipeline-bottleneck | Pipeline throughput and latency | d1 | throughput, pipelines | t5 |
| 07-retry-storm | Retry storms and retry budgets | d2 | retries, throughput | t5 |
| 08-amdahl-runtime | Amdahl's law: the serial part wins | d3 | concurrency, parallelism | t6 |

## sysdrills/07-hashing-and-sharding — Hashing, sharding & partitioning math (8)
| 01-modulo-vs-consistent | Keys moved: modulo vs consistent hashing | d2 | sharding, hashing | t5 |
| 02-node-loss-load | When a node dies: load on the survivors | d2 | sharding, consistent-hashing | t5 |
| 03-hot-key-skew | Hot-key skew on one shard | d2 | sharding, skew | t5 |
| 04-rebalance-cost | Rebalance: bytes to move and copy time | d2 | sharding, operations | t5 |
| 05-partition-pruning | Partition pruning on time ranges | d1 | partitioning, sql | t5 |
| 06-weighted-vnodes | Weighted vnodes: keys follow ownership | d2 | consistent-hashing, capacity | t5 |
| 07-scatter-gather | Scatter-gather amplification | d3 | sharding, query-routing | t5 |
| 08-partitions-and-consumers | Partitions cap consumer parallelism | d1 | partitioning, queues | t6 |

## sysdrills/08-encoding-and-counting — Encoding, storage & operation counting (8)
| 01-utf8-bytes | UTF-8 bytes vs characters | d1 | encoding | t6 |
| 02-base64-overhead | Base64 overhead | d1 | encoding | t5 |
| 03-row-size | Row size and table size | d1 | storage, schema | t5 |
| 04-page-math | Rows per page and page counts | d2 | storage, io | t5 |
| 05-loop-op-counts | Counting loop operations | d1 | big-o, counting | t6 |
| 06-binary-search-steps | Binary search: probes to find anything | d2 | big-o, search | t5 |
| 07-map-vs-nested-scan | Hash map vs nested scan | d2 | big-o, data-structures | t5 |
| 08-array-doubling | Doubling arrays: amortized O(1) appends | d3 | big-o, amortized | t5 |

## sysdrills/09-queues-and-backlog — Queues & backlog math (8)
| 01-queue-position-eta | When does my job run? Queue position math | d1 | queues, latency | t6 |
| 02-backlog-sla-threshold | Backlog alert threshold from a freshness SLA | d2 | queues, slo | t6 |
| 03-consumers-to-drain | Consumers needed to drain a lag by a deadline | d2 | queues, capacity | t6 |
| 04-retry-amplification | Retry amplification across layers | d3 | retries, architecture | t6 |
| 05-dlq-sizing | Sizing a dead-letter queue | d1 | queues, storage | t6 |
| 06-batch-vs-single-requests | Batching against a partner rate limit | d2 | batching, rate-limiting | t6 |
| 07-fanout-backlog | Fan-out on write: delivery rate and celebrity lag | d2 | queues, fan-out | t6 |
| 08-load-shedding | Load shedding during overload | d1 | overload, throughput | t6 |

## sysdrills/10-capacity-and-cost — Capacity planning & cost math (8)
| 01-cores-for-load | CPU time to cores to instances | d2 | capacity, cpu | t6 |
| 02-storage-egress-bill | Storage and egress: the monthly data bill | d1 | cost, storage | t6 |
| 03-cost-per-million | Cost per million requests and the serverless breakeven | d2 | cost, unit-economics | t5 |
| 04-autoscale-steps | Autoscaling: target tracking and step timing | d2 | autoscaling, capacity | t7 |
| 05-read-replica-sizing | Read replicas that also replay every write | d3 | replication, capacity | t6 |
| 06-replication-and-backups | Replication and backup footprint | d1 | storage, cost | t5 |
| 07-iops-budget | IOPS budget with a warm and a cold cache | d3 | capacity, io | t6 |
| 08-pool-per-instance | Splitting a database connection budget across a fleet | d2 | databases, capacity | t6 |

## sysdrills/11-replication-and-consistency — Replication & consistency math (8)
| 01-quorum-step-latency | Quorum latency: the k-th ack, not the last | d2 | replication, latency | t6 |
| 02-freshness-read-routing | Routing fresh reads: what the primary really carries | d1 | replication, capacity | t6 |
| 03-read-repair-volume | Read repair: the writes your reads create | d2 | consistency, writes | t6 |
| 04-anti-entropy-sync | Anti-entropy: full compare vs Merkle trees | d2 | replication, bandwidth | t6 |
| 05-pitr-restore-time | Point-in-time restore: snapshot copy plus WAL replay | d2 | durability, operations | t6 |
| 07-lag-breach-eta | Replica lag: how long until the SLA breaks | d2 | replication, slo | t6 |
| 08-stale-read-share | Stale reads: lag over update interval | d2 | consistency, staleness | t6 |
| 09-quorum-zone-placement | Quorum placement: surviving the loss of a whole zone | d2 | replication, availability | t7 |

## sysdrills/12-multi-region-and-failover — Multi-region & failover math (8)
| 01-failover-rpo | Failover RPO: what the lag window loses | d1 | replication, durability | t6 |
| 02-failover-rto | Failover RTO: detection, promotion, DNS | d2 | availability, operations | t6 |
| 03-region-loss-capacity | N+1 regions: surviving the loss of one | d2 | capacity, availability | t6 |
| 04-failover-error-burn | One failover, how much error budget | d2 | slo, availability | t6 |
| 05-replication-mesh-egress | Replication mesh: the cross-region egress bill | d2 | cost, bandwidth | t6 |
| 07-standby-cost | Hot-hot vs pilot light: what DR costs | d1 | cost, availability | t6 |
| 08-consensus-rtt-cap | Cross-region consensus: the speed-of-light cap | d2 | consensus, throughput | t6 |
| 09-chatty-cross-region | Chatty pages across regions: the round trips add up | d2 | latency, networking | t7 |

## sysdrills/13-search-and-indexing — Search & indexing at scale (8)
| 01-inverted-index-size | Inverted index size: postings, not pages | d1 | search, storage | t6 |
| 02-posting-list-costs | Posting-list merges: walk everything, match the rarest | d2 | search, query | t9 |
| 03-fanout-topk-overfetch | Fan-out top-K: the candidates behind ten results | d2 | search, sharding | t6 |
| 04-refresh-visibility-lag | Refresh interval: when a write becomes searchable | d1 | search, freshness | t6 |
| 05-segment-merge-writes | Segment merges: the writes behind the ingest | d2 | search, io | t6 |
| 06-ranking-cost-budget | Two-phase ranking: affording the expensive model | d2 | search, latency | t6 |
| 07-search-cluster-sizing | Search cluster sizing: fan-out multiplies replicas | d2 | search, capacity | t6 |
| 08-vector-index-memory | Vector index memory: every embedding in RAM | d1 | search, capacity | t6 |

## sysdrills/14-observability-and-telemetry — Observability & telemetry math (9)
| 01-trace-sampling-budget | Trace sampling: set the dial from the budget | d2 | observability, cost | t6 |
| 02-metric-cardinality | Metric cardinality: every label multiplies | d1 | observability, cost | t6 |
| 03-log-retention-tiers | Log retention tiers: demotion is the lever | d2 | observability, cost | t6 |
| 04-error-budget-burn-rate | Burn rate: how fast the error budget empties | d2 | slo, alerting | t6 |
| 05-alert-noise-toil | Alert noise: the on-call hours false pages burn | d1 | alerting, operations | t6 |
| 06-telemetry-overhead | Instrumentation overhead: the tax on fast requests | d1 | observability, latency | t6 |
| 07-metrics-resolution | Scrape resolution: the points a TSDB must hold | d1 | observability, storage | t6 |
| 08-head-vs-tail-sampling | Head vs tail sampling: keeping the evidence | d3 | observability, debugging | t6 |
| 09-multi-window-burn-alert | Burn-rate alerts: threshold and two windows | d2 | slo, alerting | t9 |

## sysdrills/15-node-service-runtime — Node service runtime limits (5)
| 01-event-loop-stall | One synchronous call stalls every request | d2 | node, latency | t8 |
| 02-threadpool-starvation | A login burst on the libuv threadpool | d2 | node, capacity | t8 |
| 03-bind-parameter-cap | Bulk INSERT and the bind-parameter cap | d2 | sql, batching | t8 |
| 04-keepalive-idle-chain | Keep-alive idle timeouts must grow inward | d2 | networking, node | t8 |
| 05-rolling-deploy-drain | Rolling deploys: the drain budget | d2 | operations, availability | t8 |

## sysdrills/16-data-access-and-integrity — Data access & integrity (5)
| 01-soft-delete-unique | Soft delete vs the unique index | d2 | sql, data-modeling | t8 |
| 02-optimistic-contention | Optimistic locking on a hot row | d2 | concurrency, transactions | t8 |
| 03-expand-contract-phases | Expand/contract: every live version, every phase | d3 | migrations, deploys | t8 |
| 04-sibling-include-explosion | Two includes, one JOIN: the row explosion | d2 | orm, sql | t8 |
| 05-backfill-pacing | Pacing a backfill so the replica keeps up | d2 | migrations, replication | t8 |

## sysdrills/17-client-data-layer — React client data layer (4)
| 01-fetch-waterfall | Nested fetches: the critical path | d2 | react, latency | t8 |
| 02-query-freshness | staleTime and gcTime: what a mount really does | d2 | react, caching | t8 |
| 03-visibility-gated-polling | Polling dashboards: rate and waste | d2 | react, load | t8 |
| 04-six-connections-per-domain | HTTP/1.1: six connections per domain | d1 | networking, browser | t8 |

## sysdrills/18-web-authz-and-sessions — Web authorization & sessions (4)
| 01-deny-overrides | Deny overrides, and nothing matched means no | d2 | authz, security | t8 |
| 02-tenant-scope-filter | Tenant scoping: one OR away from a leak | d3 | multitenancy, security | t8 |
| 03-session-idle-absolute | Sessions: idle timeout, absolute cap, store writes | d2 | sessions, security | t8 |
| 04-access-token-lifetime | Access-token lifetime: refresh load vs exposure | d2 | auth, capacity | t8 |

### sysdrills total: 129