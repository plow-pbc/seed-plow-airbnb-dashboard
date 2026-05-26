const createApp = require('./app');

const port = parseInt(process.env.DTU_PORT, 10) || 8787;
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`guesty-dtu listening on http://localhost:${port}`);
});
