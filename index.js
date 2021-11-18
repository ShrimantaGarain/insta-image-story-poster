
const logger = require("./logger.js")
const { random, sleep } = require('./utils')
require('dotenv').config();

const { IgApiClient, IgLoginTwoFactorRequiredError } = require("instagram-private-api");
const ig = new IgApiClient();

const Bluebird = require('bluebird');
const inquirer = require('inquirer');
const { CronJob } = require('cron');

const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

const sharp = require("sharp");


//==================================================================================

const statePath = "./etc/state.conf";
const recordPath = "./etc/usedfiles.jsonl";
const imgFolderPath = "./images/"; 

const dryrun = false;
const runOnStart = true;

//==================================================================================







(async () => { // FOR AWAIT

    // LOGIN TO INSTAGRAM
    if (!dryrun) {
        await login();
        logger.info("Log In Successful");
    } else {
        logger.info("Dry Run Activated");
    }

    // SCHEDULER
    // logger.silly("I'm a schedule, and I'm running!! :)");
    const job = new CronJob('38 16 * * * *', post, null, true); //https://crontab.guru/
    if (!runOnStart) logger.info(`Next few posts scheduled for: \n${job.nextDates(3).join("\n")}\n`);
    else post(); 


    // MAIN POST COMMAND
    async function post() {
        logger.info("Post() called! ======================");
        
        let postPromise = fsp.readdir(imgFolderPath)
        .then(filenames => {
            if (filenames.length < 1) throw new Error(`Folder ${imgFolderPath} is empty...`)
            logger.debug(`${filenames.length} files found in ${imgFolderPath}`);
            return filenames;
        })
        .then(filenames => filenames.map(file => path.resolve(imgFolderPath + file)))
        .then(filenames => pickUnusedFileFrom(filenames, filenames.length))
        .then(filename => {
            if (!dryrun) registerFileUsed(filename)
            return filename
        })
        .then(fsp.readFile)
        .then(async buffer => {
            logger.debug("Read File Success ");  //TODO move this to previous then?          
            return sharp(buffer).jpeg().toBuffer()
            .then(file => {
                logger.debug("Sharp JPEG Success");
                return file
            })
        })
        .then(async file => {
            if (!dryrun) {
                // await sleep(random(1000, 60000)) //TODO is this necessary?
                return ig.publish.story({ file })
                .then(fb => logger.info("Posting successful!?"))
            } 
            else return logger.info("Data not sent, dryrun = true")
        })
        .then(() => logger.info(`Next post scheduled for ${job.nextDates()}\n`))
        .catch(logger.error)
    }
})();





//=================================================================================

async function login() {
    ig.state.generateDevice(process.env.IG_USERNAME);
    // ig.state.proxyUrl = process.env.IG_PROXY;

    //register callback?
    ig.request.end$.subscribe(async () => {
        const serialized = await ig.state.serialize();
        delete serialized.constants; // this deletes the version info, so you'll always use the version provided by the library
        await stateSave(serialized);
    });
    

    if (await stateExists()) {
        // import state accepts both a string as well as an object
        // the string should be a JSON object
        const stateObj = await stateLoad();
        await ig.state.deserialize(stateObj)
        .catch(err => logger.debug("deserialize: " + err));
    } else {
        

        let standardLogin = async function() {
            // login like normal
            await ig.simulate.preLoginFlow();
            logger.debug("preLoginFlow finished");
            await ig.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD);
            logger.info("Logged in as " + process.env.IG_USERNAME);
            process.nextTick(async () => await ig.simulate.postLoginFlow());
            logger.debug("postLoginFlow finished");
        }

        // Perform usual login
        // If 2FA is enabled, IgLoginTwoFactorRequiredError will be thrown
        return Bluebird.try(standardLogin)
        .catch(
            IgLoginTwoFactorRequiredError,
            async err => {
                logger.info("Two Factor Auth Required");
                
                const {username, totp_two_factor_on, two_factor_identifier} = err.response.body.two_factor_info;
                // decide which method to use
                const verificationMethod = totp_two_factor_on ? '0' : '1'; // default to 1 for SMS
                // At this point a code should have been sent
                // Get the code
                const { code } = await inquirer.prompt([
                    {
                    type: 'input',
                    name: 'code',
                    message: `Enter code received via ${verificationMethod === '1' ? 'SMS' : 'TOTP'}`,
                    },
                ]);
                // Use the code to finish the login process
                return ig.account.twoFactorLogin({
                    username,
                    verificationCode: code,
                    twoFactorIdentifier: two_factor_identifier,
                    verificationMethod, // '1' = SMS (default), '0' = TOTP (google auth for example)
                    trustThisDevice: '1', // Can be omitted as '1' is used by default
                });
            },
        )
        .catch(e => logger.error('An error occurred while processing two factor auth', e, e.stack));
    }

    return 

    //================================================================================

    async function stateSave(data) {
        // here you would save it to a file/database etc.
        await fsp.mkdir(path.dirname(statePath), { recursive: true }).catch(logger.error);
        return fsp.writeFile(statePath, JSON.stringify(data))
        // .then(() => logger.info('state saved, daddy-o'))
        .catch(err => logger.error("Write error" + err));
    }
      
    async function stateExists() {
        return fsp.access(statePath, fs.constants.F_OK)
        .then(() => {
            logger.debug('Can access state info')
            return true
        })
        .catch(() => {
            logger.warn('Cannot access state info')
            return false
        });
    }
      
    async function stateLoad() {
        // here you would load the data
        return fsp.readFile(statePath, 'utf-8')
        .then(data => JSON.parse(data))
        .then(data => {
            logger.info("State load successful");
            return data
        })
        .catch(logger.error)
    }
}

async function registerFileUsed( filepath ) {

    let data = JSON.stringify({
        path: filepath,
        time: new Date().toISOString()
    }) + '\n';

    return fsp.appendFile(recordPath, data, { encoding: 'utf8', flag: 'a+' } )
    .then(() => {
        logger.debug("Writing filename to record file"); 
        return filepath
    })
}

function pickUnusedFileFrom( filenames, iMax = 1000) {
    return new Promise((resolve, reject) => {

        let checkFileUsed = async function ( filepath ) {
            return fsp.readFile(recordPath, 'utf8')
            .then(data => data.split('\n'))
            .then(arr => arr.filter(Boolean))
            .then(arr => arr.map(JSON.parse))
            .then(arr => arr.some(entry => entry.path === filepath))
        } 

        let trythis = function( iMax, i = 1) {
            let file = random(filenames);
            checkFileUsed(file)
            .then(async used => {
                if (!used) {
                    logger.info(`Unused file found! ${file}`);
                    resolve(file);
                } else if (i < iMax) {
                    logger.debug(`Try #${i}: File ${file} used already`);
                    await sleep(50);
                    trythis(iMax, ++i)
                } else {
                    reject(`I tried ${iMax} times and all the files I tried were previously used`)
                }
            })
            .catch(err => {
                logger.warn("Record file not found, saying yes to " + file);
                resolve(file);
            })
        }( iMax );
    })
}



