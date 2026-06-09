import { pino } from 'pino';

export function createExampleLogger(name) {
  return pino({
    base: undefined,
    name,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        singleLine: true,
        translateTime: 'SYS:standard',
      },
    },
  });
}
