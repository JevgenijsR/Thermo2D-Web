importScripts("fem-solver.js?v=20261026-2", "fem-examples.js?v=20261026-2");
onmessage = ({ data }) => {
  try {
    let completed = 0;
    for (const job of data.jobs) {
      const result = ThermoFEM.solve(job.model, job.options, (message) =>
        postMessage({ id: data.id, message }),
      );
      if (!result.converged)
        throw Error(
          `Расчёт не принят: невязка ${result.stats.residual}, баланс ${result.heat.balance}.`,
        );
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
