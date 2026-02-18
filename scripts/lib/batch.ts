export async function processBatches<T>(
  items: T[],
  batchSize: number,
  processor: (batch: T[], batchIndex: number) => Promise<void>,
  delayMs = 1000
): Promise<void> {
  const totalBatches = Math.ceil(items.length / batchSize);

  for (let i = 0; i < items.length; i += batchSize) {
    const batchIndex = Math.floor(i / batchSize) + 1;
    const batch = items.slice(i, i + batchSize);

    console.log(
      `Processing batch ${batchIndex}/${totalBatches} (${batch.length} items)`
    );

    await processor(batch, batchIndex);

    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
