import '@iotize/tap-app-core.node/register/wifi';
import '@iotize/tap-app-core.node/register/socket';
import {scannerProvider, TapProtocolFactory} from '@iotize/tap-app-core.node';
import { tapProtocolFactory} from '@iotize/tap-app-core.node';
import '@iotize/device-client.js/ext/configurator';

import * as AwsCli from 'aws-cli-js';
import { Tap } from "@iotize/device-client.js";
import { readdirSync, readFileSync } from "fs";
import { join } from 'path';
import { wifi, WifiComProtocol } from "@iotize/device-com-wifi.node";
import { TapConfigSchema } from "@iotize/device-client.js/config/schema/v1";
import { validateTapConfig } from '@iotize/device-client.js/configurator';
import { SocketProtocol } from "@iotize/device-com-socket.node";
import { ComProtocol } from "@iotize/device-client.js/protocol/api";


const Options = AwsCli.Options;
const Aws = AwsCli.Aws;
const ACCES_KEY = '';
const SECRET_KEY = '';
const options = new Options(
    ACCES_KEY,
    SECRET_KEY,
    /* sessionToken */ '',
    /* currentWorkingDirectory */ ''
);
const aws = new Aws(options);
const TAP_WEB_KEY = '**';

wifi.init({
    iface: null // network interface, choose a random wifi interface if set to null
});



interface CertFile {
    privateKey: string,
    deviceCertificate: string,
    broker: string
}

interface OptionsWifi {
    socket: {
        host: string;
        port: number;
    };
    network?: {
        SSID: string;
        password?: string;
        algorithm?: string;
        hidden?: boolean;
    };
}

interface Options {
    port: number,
    host: string,
    clientId: string,
    username: string,
    password: string,
    deviceCertificate: string,
    privateKey: string,
    broker: string
}

start();

/**
 * Start command from aws cli
 * iot list things
 * send data result to method getListThingsWithConfigType()
 */
function start() {
    try {
        aws.command('iot list-things').then(function (data) {
            let things = data.object.things;
            getListThingsWithConfigType({things: things}).then(() => console.log('List of device with good type found.'));
        });

    }catch (e) {
        console.log(e);
    }
}

/**
 * Filter the result list things from command
 * get element of the list with ask type name
 * @param things
 */
async function getListThingsWithConfigType({things}: { things: any }) {
    let listThingsWithGoodType = await (things.filter((file: { thingTypeName: string; }) => {
        return file.thingTypeName == 'TAP-LINK-CONFIG';
    }));
    let listCert: CertFile[] = [];
    let brokerFile = await readFileSync('./ca-broker-root.txt').toString();
    let broReplceR = brokerFile.replace(
        /\r/g, '');
    let broReplceN = broReplceR.replace(
        /\n/g, '');
    let brokerCa = broReplceN.slice(27, broReplceN.length-25)
    await (readdirSync('./devices').map( async element => {
        let certFile: CertFile = {
            privateKey: '',
            deviceCertificate: '',
            broker: brokerCa
        }
        await (readdirSync(join('./devices', element)).map(async cert => {
            if (cert.includes('private.pem')) {
                let file = readFileSync(join('./devices/', element, cert)).toString();
                let pkey = file.replace(
                    /\n/g, '');
                certFile.privateKey = pkey.slice(31,pkey.length-29);
            }
            if (cert.includes('certificate.pem')) {
                let file = readFileSync(join('./devices/', element, cert)).toString();
                let certificate = file.replace(
                    /\n/g, '');
                certFile.deviceCertificate = certificate.slice(27,certificate.length-25);
            }
        }))
        listCert.push(certFile);
    }))
    await getTapList(listThingsWithGoodType, listCert);
}


/**
 * Scan all wifi device
 * Get tap wifi config for socket connect
 * Prepares the parameters to be entered in the tap broker
 * @param listThingsWithGoodType
 * @param listCert
 */
async function getTapList(listThingsWithGoodType: any, listCert: CertFile[]) {
    const scanTimeout = 5 * 1000;
    const items = await scannerProvider.list(scanTimeout).toPromise();
    let listTapWifi = await (items.filter((tap: { name: string; }) => {
       return tap.name.includes('TP-LINK');
    }));
    console.log(listTapWifi);
    let count = 0;
    for (const tapFind of listTapWifi) {
        let options: Options = {
            port: 8883,
            host: listThingsWithGoodType[count].attributes.host,
            clientId: listThingsWithGoodType[count].thingName,
            username: '',
            password: '',
            deviceCertificate: listCert[count].deviceCertificate,
            privateKey: listCert[count].privateKey,
            broker: listCert[count].broker
        };
        await wifiConnect(tapFind, options);
        count++;
    }
}

/**
 * Connect to the tap with wifi
 * Get tap config from file conf.tapconfig.json
 * Set broker param with device info
 * Check tap config
 * Configure and reboot the tap
 * @param tapFind
 * @param tapWifiConfig
 * @param options
 */
async function wifiConnect(tapFind: any, options: Options) {

    console.log(tapFind.payload.ssid);
    await wifi.connect({ ssid: tapFind.payload.ssid, password: 'ABCD1234' }, async (test:string) => {
        console.log('Connected to wifi');
    });

    await setTimeout(function waitConnect() {
        tapConfigAndConnect(tapFind,options);
    }, 3000);

}


async function tapConfigAndConnect(tapFind: any, options: Options) {
    const optionsWifi:OptionsWifi = {
        socket: {
            host:'192.168.4.1',
            port: 2000
        },
        network: {
            SSID: tapFind.payload.ssid,
            password: 'ABCD1234',
            algorithm: '',
            hidden: true
        }
    }
    const protocol = new WifiComProtocol(optionsWifi, (op) => new SocketProtocol(
        {
            host: op.socket.host,
            port: op.socket.port
        }));
    const tap = Tap.fromProtocol(protocol);
    const config = readFileSync('./conf.tapconfig.json');
    console.log('Get tap config schema');
    const tapConfig: TapConfigSchema = JSON.parse(config.toString());

    if (!tapConfig.config.tap) {
        tapConfig.config.tap = {}
    }
    tapConfig.config.tap.mqttRelay = {
        clientId: options.clientId,
        // deviceCertificate: options.deviceCertificate,
        // privateKey: options.privateKey,
        // caCertificate: options.broker,
        netKey: "testnetkey",
        password: tapFind.name + '_0000000000',
        topicPrefix: "",
        url: "user.cloud.iotize.com",
        username: tapFind.name
    }
    console.log('Validate tap config');
    await validateTapConfig(tapConfig);
    console.log(`Connect`);
    await tap.connect();
    console.log(`Connecting tap...`);
    await tap.login("admin", "admin");
    console.log(`Configuring tap...`);
    await tap.configurator.configure(tapConfig);
    console.log('Configuration successful!');
    console.log(`Rebooting tap...`);
    (await tap.service.device.reboot()).successful();
}