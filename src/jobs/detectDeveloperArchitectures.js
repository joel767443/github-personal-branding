const prisma = require("../db/prisma");
const {
  createGithubClient,
  getEnvGithubClient,
  getRepoTopics,
  getRepoGitTreeFilesWithBranchFallback,
} = require("../services/githubService");
const { getGithubCredentialsForDeveloper } = require("../services/developerCredentials");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ARCH_KEYWORDS = {
  "Monolithic Architecture": ["monolith", "monolithic", "single codebase", "all-in-one"],
  "Modular Monolith": ["modular monolith", "modulith", "vertical slice", "feature folder"],
  "Layered Architecture": ["layered", "n-tier", "3-tier", "presentation layer", "business layer", "data access layer"],
  "Hexagonal Architecture": ["hexagonal", "ports and adapters", "clean architecture", "onion architecture"],
  "API Architecture": ["api", "rest api", "graphql", "openapi", "swagger"],
  "Microservices": ["microservice", "microservices", "service mesh", "istio", "linkerd", "docker-compose", "k8s.yaml", "kubernetes", "helm"],
  "Event-Driven Architecture": ["event-driven", "eda", "kafka", "rabbitmq", "pub/sub", "event bus", "event sourcing", "nats", "pulsar"],
  "Serverless Architecture": ["serverless", "lambda", "function as a service", "faas", "aws lambda", "vercel", "netlify functions", "serverless.yml"],
  CQRS: ["cqrs", "command query", "command-query responsibility segregation", "read model", "write model"],
  "Machine Learning Systems": ["ai", "ml", "machine learning", ".ipynb", "tensorflow", "pytorch", "torch", "scikit-learn", "huggingface", "keras"],
  "Multi Tenant SaaS": ["saas", "multi-tenant", "multi tenancy", "tenant id", "tenant isolation"],
  Jamstack: ["jamstack", "static site", "static-first", "headless cms", "pre-rendered", "ssg", "next.js static", "gatsby", "hugo"],
  "Micro Frontends": ["micro frontend", "micro-frontends", "module federation", "single-spa"],
  "AI-Native Architecture": ["ai-native", "agentic", "multi-agent", "rag", "retrieval augmented", "ai pipeline"],
  "Edge Computing": ["edge computing", "cloudflare workers", "fastly", "vercel edge", "edge functions", "@edge"],
  SOA: ["soa", "service-oriented", "esb", "enterprise service bus", "soap"],
  "Actor Model": ["actor model", "akka", "erlang", "elixir", "orleans", "message-passing"],
  "Data Mesh": ["data mesh", "data lakehouse", "snowflake", "databricks", "data-product"],
  "Zero Trust": ["zero trust", "zta", "micro-segmentation", "identity-aware"],
  "Distributed Systems": [
    "distributed system",
    "distributed architecture",
    "consensus",
    "raft",
    "paxos",
    "eventual consistency",
    "strong consistency",
    "cap theorem",
    "replication",
    "sharding",
  ],
  "Service-Oriented Architecture": ["soa", "service-oriented", "soap", "wsdl", "enterprise service bus", "esb"],
  "Domain-Driven Design": ["ddd", "domain-driven design", "bounded context", "aggregate", "entity", "value object", "ubiquitous language", "domain model"],
  "Event Sourcing": ["event sourcing", "event store", "append-only log", "replay events", "temporal modeling"],
  "Backend for Frontend": ["bff", "backend for frontend", "frontend-specific backend", "ui gateway"],
  "API Gateway": ["api gateway", "gateway service", "kong", "nginx gateway", "aws api gateway", "edge gateway", "rate limiting", "routing layer"],
  "Data Architecture": ["data pipeline", "etl", "elt", "data lake", "data warehouse", "airflow", "batch processing", "stream processing", "spark", "flink"],
  "Streaming Architecture": ["stream processing", "real-time streaming", "kafka streams", "flink", "kinesis", "event streaming"],
  "Plugin Architecture": ["plugin system", "extension system", "hook system", "middleware pipeline", "event hooks", "modular plugins"],
  "Pipeline Architecture": ["pipeline", "workflow", "dag", "directed acyclic graph", "job orchestration", "task runner"],
  "Client-Server Architecture": ["client-server", "client server model", "frontend backend separation"],
  "Peer-to-Peer": ["p2p", "peer-to-peer", "distributed nodes", "torrent", "blockchain network"],
  "Blockchain Architecture": ["blockchain", "smart contract", "ethereum", "web3", "solidity", "decentralized app", "dapp"],
  "Reactive Architecture": ["reactive", "non-blocking", "backpressure", "reactive streams", "project reactor", "rxjava"],
  "Resilient Architecture": ["fault tolerant", "resilience", "circuit breaker", "retry pattern", "bulkhead", "failover"],
};

const ARCH_KEYWORDS_LOWER = Object.fromEntries(
  Object.entries(ARCH_KEYWORDS).map(([arch, keywords]) => [arch, keywords.map((k) => String(k).toLowerCase())]),
);

/** `DeveloperArchitecture.name` FKs to `Architecture.name`; rows must exist before linking. */
async function ensureArchitectureRowsForKeywords() {
  const names = Object.keys(ARCH_KEYWORDS);
  if (names.length === 0) return;
  await prisma.architecture.createMany({
    data: names.map((name) => ({ name, count: 0 })),
    skipDuplicates: true,
  });
}

async function rebuildArchitectureCatalogFromDeveloperLinks() {
  const grouped = await prisma.developerArchitecture.groupBy({
    by: ["name"],
    _sum: { count: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.architecture.deleteMany();
    if (grouped.length > 0) {
      await tx.architecture.createMany({
        data: grouped.map((g) => ({
          name: g.name,
          count: g._sum.count ?? 0,
        })),
      });
    }
  });
}

/**
 * @param {{ branch?: string, onProgress?: function, developerId?: number }} opts
 * When `developerId` is set, only that tenant's repos are scanned and only their
 * `developer_architectures` rows are replaced; the global `architectures` catalog is rebuilt from all per-developer rows.
 */
async function detectDeveloperArchitectures({ branch = "main", onProgress, developerId } = {}) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  const githubCache = new Map();
  async function githubForRepoDeveloper(devId) {
    const key = devId ?? "__none__";
    if (githubCache.has(key)) return githubCache.get(key);
    const creds = devId != null ? await getGithubCredentialsForDeveloper(devId) : null;
    const client = creds?.token ? createGithubClient(creds.token) : getEnvGithubClient();
    githubCache.set(key, client);
    return client;
  }

  const repos = await prisma.repo.findMany({
    where: developerId != null ? { developerId } : undefined,
    select: {
      id: true,
      name: true,
      fullName: true,
      description: true,
      developerId: true,
    },
  });

  const devArchitectures = new Map();
  let skipped = 0;
  progress("Detecting architectures", {
    totalRepos: repos.length,
    branch,
    scopedDeveloperId: developerId ?? null,
  });

  for (let idx = 0; idx < repos.length; idx++) {
    const repo = repos[idx];
    const github = await githubForRepoDeveloper(repo.developerId);

    const fullName = repo.fullName || `${repo.name}`;
    if (!fullName || !fullName.includes("/")) {
      skipped += 1;
      continue;
    }

    const [owner, repoName] = fullName.split("/", 2);
    if (!owner || !repoName) {
      skipped += 1;
      continue;
    }

    let topics = [];
    try {
      topics = await getRepoTopics(github, owner, repoName);
    } catch {
      topics = [];
    }

    let files = [];
    try {
      files = await getRepoGitTreeFilesWithBranchFallback(github, owner, repoName, branch);
    } catch {
      files = [];
    }

    const text = [
      String(repo.name ?? "").toLowerCase(),
      String(repo.description ?? "").toLowerCase(),
      topics.map((t) => String(t).toLowerCase()).join(" "),
      files.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    const detected = new Set();
    for (const [arch, keywords] of Object.entries(ARCH_KEYWORDS_LOWER)) {
      if (keywords.some((kw) => text.includes(kw))) {
        detected.add(arch);
      }
    }

    if (detected.size > 0) {
      for (const arch of detected) {
        if (repo.developerId != null) {
          const devId = repo.developerId;
          const bucket = devArchitectures.get(devId) ?? {};
          bucket[arch] = (bucket[arch] ?? 0) + 1;
          devArchitectures.set(devId, bucket);
        }
      }
    }

    await sleep(1000);
  }

  const devArchitectureRows = [];
  for (const [devId, bucket] of devArchitectures.entries()) {
    for (const [name, count] of Object.entries(bucket)) {
      devArchitectureRows.push({
        developerId: devId,
        name,
        count,
      });
    }
  }
  console.log("devArchitectureRows", devArchitectureRows);
  // Replace after scan: failed runs keep prior rows; FK parents exist before insert.
  if (developerId != null) {
    await prisma.developerArchitecture.deleteMany({ where: { developerId } });
  } else {
    await prisma.developerArchitecture.deleteMany();
    await prisma.architecture.deleteMany();
  }
  if (devArchitectureRows.length > 0) {
    await ensureArchitectureRowsForKeywords();
    await prisma.developerArchitecture.createMany({
      data: devArchitectureRows,
      skipDuplicates: true,
    });
  }

  await rebuildArchitectureCatalogFromDeveloperLinks();

  progress("Architecture detection complete", {
    totalRepos: repos.length,
    detectedArchitectureNames: devArchitectureRows.length,
  });

  return {
    skipped,
    totalRepos: repos.length,
    detectedArchitectureLinks: devArchitectureRows.length,
  };
}

module.exports = detectDeveloperArchitectures;
