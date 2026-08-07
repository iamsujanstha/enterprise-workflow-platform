import * as winston from 'winston';

export function createWinstonLogger(): winston.LoggerOptions {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    level: isProduction ? 'info' : 'debug',
    format: isProduction
      ? winston.format.combine(
          winston.format.timestamp(),
          winston.format.json(),
        )
      : winston.format.combine(
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.colorize(),
          winston.format.simple(),
        ),
    transports: [new winston.transports.Console()],
  };
}
