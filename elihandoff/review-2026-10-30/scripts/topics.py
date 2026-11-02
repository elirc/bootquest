import json,glob,re,collections,os
os.chdir('C:/Users/Owner/Desktop/selfboot')
TOPICS={
 'TS type-level (generics/conditional/mapped/branded/narrowing/discriminated)': r'\bgeneric|conditional type|mapped type|branded|\binfer\b|narrow|discriminated union|type guard|satisfies|\bunknown\b.*\btype\b|utility type|Pick<|Omit<|Record<',
 'React hooks pitfalls (useEffect/useMemo/useCallback/stale closure/StrictMode)': r'useEffect|useMemo|useCallback|stale closure|StrictMode|dependency array|re-render|useRef',
 'React state mgmt (zustand/redux/context/TanStack Query/RSC)': r'zustand|redux|useContext|Context\.Provider|TanStack|React Query|queryClient|invalidateQueries|staleTime|Server Component|"use client"|use client',
 'Forms/validation (zod/react-hook-form/FluentValidation/Bean Validation)': r'\bzod\b|ZodError|safeParse|react-hook-form|FluentValidation|@Valid|Bean Validation|DataAnnotations|ModelState',
 'Testing (Vitest/RTL/Playwright/xUnit/JUnit/Testcontainers/mocks)': r'\bvitest\b|Testing Library|\bRTL\b|playwright|xUnit|JUnit|Testcontainers|\bmock|\bstub\b|\bspy\b|supertest|WebApplicationFactory|MockMvc|@SpringBootTest',
 'Node/Express/Fastify/Next route handlers (middleware, error handler)': r'express|fastify|app\.use|next\(err|route handler|Route Handler|middleware',
 'ORM (Prisma/Drizzle/knex/EF Core/JPA/Hibernate)': r'prisma|drizzle|\bknex\b|EF Core|DbContext|SaveChanges|Hibernate|\bJPA\b|JpaRepository|EntityManager|N\+1|lazy load',
 'SQL/Postgres (index/transaction/isolation/lock/constraint/migration)': r'\bindex\b|\btransaction\b|isolation|SERIALIZABLE|READ COMMITTED|FOR UPDATE|deadlock|unique constraint|foreign key|\bmigration|\bjoin\b|EXPLAIN|timestamptz|\bjsonb\b|ON CONFLICT|upsert',
 'Auth/session/JWT/cookies/OAuth/Identity': r'\bJWT\b|bearer|cookie|session|OAuth|refresh token|ASP\.NET Core Identity|Identity\b|Spring Security|bcrypt|argon|password hash|CSRF|SameSite|HttpOnly',
 'Authorization (RBAC/ownership/tenant/IDOR/BOLA)': r'\bRBAC\b|role|ownership|tenant|IDOR|BOLA|\[Authorize\]|permission|scope',
 'HTTP semantics/caching (ETag/Cache-Control/304/idempotency/status codes)': r'ETag|Cache-Control|\b304\b|If-None-Match|idempoten|\b409\b|\b422\b|\b412\b|Retry-After|\b429\b|PATCH|conditional request',
 'Security (OWASP: injection/XSS/SSRF/mass assignment/secrets/rate limit)': r'injection|\bXSS\b|SSRF|mass assignment|open redirect|rate limit|secret|\.env\b|sanitiz|escape|CORS|enumeration|timing attack|constant-time',
 'Docker/CI/deploy/env config': r'docker|compose|\bCI\b|GitHub Actions|pipeline|deploy|rolling|blue.green|feature flag|\.nvmrc|env var|environment variable',
 'Observability (logging/metrics/tracing/correlation id/health)': r'\blog\b|logging|logger|metric|tracing|trace id|correlation|OpenTelemetry|health check|/health|alert|p99|latency',
 'Async/concurrency (race/retry/backoff/queue/worker/outbox/locks)': r'\brace\b|retry|backoff|\bqueue\b|worker|outbox|BullMQ|SemaphoreSlim|\block\b|optimistic concurrency|version_conflict|concurrency|Promise\.all|CompletableFuture|async|await|cancellation',
 '.NET web (minimal API/controllers/DI lifetimes/middleware/ProblemDetails)': r'minimal API|MapGet|MapPost|\[FromBody\]|AddScoped|AddSingleton|captive dependency|ProblemDetails|IExceptionHandler|UseExceptionHandler|MediatR|IOptions|HttpClientFactory',
 'Spring Boot/JPA/Spring Security': r'Spring|@RestController|@Transactional|@Service|@Autowired|JpaRepository|Spring Security|@Valid',
 'Git workflows / code review / PR hygiene': r'\bgit\b|branch|rebase|pull request|\bPR\b|code review|commit message|merge conflict|reviewer',
 'Debugging/profiling/performance': r'debug|breakpoint|stack trace|profil|flame|memory leak|bundle size|slow query|benchmark|Big-O|O\(n',
 'Money/decimal/time zones': r'\bcents\b|BigDecimal|\bdecimal\b|rounding|time zone|timezone|\bUTC\b|Instant|ZonedDateTime|DST|DateTimeOffset',
 'Pagination/filtering/search': r'paginat|cursor|offset|\btake\b|LIMIT|typeahead|full-text|search index|debounce',
}
rx={k:re.compile(v,re.I) for k,v in TOPICS.items()}
hits={k:collections.Counter() for k in TOPICS}
nq=0
for f in glob.glob('content/seed/quests/*/items.json'):
    pack=os.path.basename(os.path.dirname(f))
    for it in json.load(open(f,encoding='utf-8'))['items']:
        if it['kind']=='quiz': text=it['prompt']+' '+' '.join(c['text'] for c in it['choices'])+' '+str(it.get('explanation','')); nq+=1
        elif it['kind']=='flashcard': text=it['front']+' '+it['back']
        else: continue
        for k,r in rx.items():
            if r.search(text): hits[k][pack]+=1
print('quiz+flashcard items scanned:', nq)
for k in TOPICS:
    c=hits[k]; tot=sum(c.values()); packs=len(c)
    print(f"\n### {k}\n  items={tot} packs={packs} top: {', '.join(f'{p}({n})' for p,n in c.most_common(8))}")
