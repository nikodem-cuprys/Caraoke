import { createApp } from "./app";
import { config } from "./config";

const app = createApp();

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`SingLearn API listening on http://localhost:${config.port} (env=${config.nodeEnv})`);
});
