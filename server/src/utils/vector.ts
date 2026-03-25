export function elementWiseMean(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const mean = Array.from<number>({ length: dim }).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      mean[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    mean[i] /= vectors.length;
  }
  return mean;
}
