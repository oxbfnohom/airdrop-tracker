export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const db = (await import("./lib/db")).default;
    const { initLlmUsage } = await import("./lib/llm");
    initLlmUsage(db); // counter pemakaian LLM per hari (biar kelihatan hematnya)
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
