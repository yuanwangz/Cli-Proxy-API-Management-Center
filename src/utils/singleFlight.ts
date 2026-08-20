export type AsyncTask<T> = () => Promise<T>;

export const createSingleFlight = <T>() => {
  let inFlight: Promise<T> | null = null;

  return (task: AsyncTask<T>): Promise<T> => {
    if (inFlight) return inFlight;

    const request = Promise.resolve().then(task);
    const trackedRequest = request.finally(() => {
      if (inFlight === trackedRequest) {
        inFlight = null;
      }
    });
    inFlight = trackedRequest;
    return trackedRequest;
  };
};
