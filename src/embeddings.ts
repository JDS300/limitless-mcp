const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

export async function generateEmbedding(
  ai: Ai,
  text: string
): Promise<number[]> {
  if (!text) {
    throw new Error('generateEmbedding requires non-empty text');
  }
  const result = await ai.run(EMBEDDING_MODEL, { text: [text] });
  // The output type is a union: { data?, shape?, pooling? } | { request_id? }
  // Narrow to the non-async variant by checking for 'data'
  if (!('data' in result) || !result.data || result.data.length === 0) {
    throw new Error('Workers AI returned empty embedding');
  }
  // result.data.length > 0 is guaranteed by the guard above, so data[0] is defined
  return result.data[0];
}
