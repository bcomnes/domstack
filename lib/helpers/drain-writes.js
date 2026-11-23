/**
 * Wait for every writer before returning results or reporting a failure.
 *
 * @template {readonly unknown[] | []} T
 * @param {T} tasks
 * @returns {Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }>}
 */
export async function drainWrites (tasks) {
  const settled = await Promise.allSettled(tasks)
  return /** @type {{ -readonly [K in keyof T]: Awaited<T[K]> }} */ (settled.map(result => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  }))
}
