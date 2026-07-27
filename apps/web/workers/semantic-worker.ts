import { pipeline } from "@huggingface/transformers";

type Document = { id: string; text: string };
type Extractor = (
  text: string | string[],
  options: { pooling: "mean"; normalize: true },
) => Promise<{ tolist(): unknown[] }>;

let extractor: Extractor | null = null;
let documents: Document[] = [];
let vectors: number[][] = [];

async function model() {
  if (!extractor) {
    self.postMessage({ type: "status", status: "loading" });
    extractor = (await pipeline(
      "feature-extraction",
      "onnx-community/all-MiniLM-L6-v2-ONNX",
      { dtype: "q8" },
    )) as unknown as Extractor;
    self.postMessage({ type: "status", status: "ready" });
  }
  return extractor;
}

async function embed(text: string | string[]) {
  const featureExtractor = await model();
  const output = await featureExtractor(text, {
    pooling: "mean",
    normalize: true,
  });
  return output.tolist() as number[][];
}

type WorkerRequest =
  | { type: "index"; documents: Document[] }
  | { type: "query"; query: string };

async function handleRequest(event: MessageEvent<WorkerRequest>) {
  try {
    if (event.data.type === "index") {
      documents = event.data.documents;
      vectors = documents.length
        ? await embed(documents.map((document) => document.text))
        : [];
      self.postMessage({ type: "indexed", count: documents.length });
      return;
    }

    const query = event.data.query.trim();
    if (!query || !vectors.length) {
      self.postMessage({ type: "results", ids: [] });
      return;
    }
    const [queryVector] = await embed(query);
    const ranked = documents
      .map((document, index) => ({
        id: document.id,
        score: vectors[index].reduce(
          (sum, value, dimension) =>
            sum + value * (queryVector[dimension] ?? 0),
          0,
        ),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 12);
    self.postMessage({ type: "results", ids: ranked.map((result) => result.id) });
  } catch (error) {
    self.postMessage({
      type: "status",
      status: "fallback",
      error: error instanceof Error ? error.message : "Semantic model failed.",
    });
  }
}

let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => handleRequest(event));
};
