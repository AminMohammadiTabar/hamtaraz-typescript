import { createHamtarazServer } from './web/server.ts';
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
createHamtarazServer().listen(port, () => console.log(`Hamtaraz TypeScript: http://localhost:${port}`));
