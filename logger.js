
const logsPath = "./etc/logs/";
require("fs").mkdirSync(logsPath, { recursive: true });

const winston = require('winston');
const logger = winston.createLogger({
    exitOnError: false,
    transports: [
        new winston.transports.Console({ 
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }), 
                // winston.format.simple()
                winston.format.printf(info => {
                    return `${info.timestamp} - ${info.level}: ${info.message}`
                })
            ),
            level: 'silly' 
        }),
        new winston.transports.File({ 
            filename: `${logsPath}log-${new Date().getTime()}.jsonl`,
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            level: 'debug',
            handleExceptions: true
        })
    ]
});


module.exports = logger;