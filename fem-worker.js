/* Worker message handler. On the page this file only registers itself: the page
 * builds the Worker from the already loaded solver, examples and this handler
 * (Function.toString), so file:// needs no packed copy and no build step.
 * Served over HTTP it can also run directly as a worker file. */
(function thermoWorker(root) {
  if (typeof document !== "undefined") {
    root.ThermoWorkerMain = thermoWorker;
    return;
  }
  if (typeof ThermoFEM === "undefined")
    importScripts("fem-solver.js?v=20261101-1", "fem-examples.js?v=20261101-1");
  root.onmessage = ({ data }) => {
    try {
      if (data.transient) {
        const { model, options, scenario } = data.transient,
          out = ThermoFEM.transient(model, options, scenario, (message) =>
            postMessage({ id: data.id, message }),
          );
        // Frames are large; hand their buffers over instead of copying.
        postMessage({ id: data.id, transient: out }, out.frames.map((f) => f.buffer));
        return;
      }
      let completed = 0;
      for (const job of data.jobs) {
        const progress = (message) => postMessage({ id: data.id, message });
        const result = ThermoFEM.solve(job.model, job.options, progress);
        if (!result.converged)
          throw Error(
            `Расчёт не принят: невязка ${result.stats.residual}, баланс ${result.heat.balance}.`,
          );
        if (job.vapour)
          result.vapour = job.vapour.mode === "surface"
            ? ThermoFEM.surfaceHumidity(job.model,result,job.vapour)
            : ThermoFEM.vapour(job.model, result, job.vapour, progress);
        if (result.vapour && !result.vapour.surfaceOnly && !result.vapour.converged) throw Error("Расчёт влажности не сошёлся; результат не принят.");
        completed++;
        postMessage({
          id: data.id,
          message: `Готово ${completed}/${data.jobs.length}`,
          partial: result,
        });
      }
      postMessage({ id: data.id, done: true });
    } catch (error) {
      postMessage({ id: data.id, error: error.message });
    }
  };
})(globalThis);
