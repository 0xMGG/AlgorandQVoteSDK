import * as algosdk from "algosdk";
import { ADD_OPTION_SYM, OPTION_SYM, NULL_OPTION_SYM } from "./QVote/symbols";
import { qvApprovalProgram, qvClearProgram, queueApprovalProgram, queueClearProgram } from "../ContractCode";
import { QVoteState } from "./types";
import { Transaction, Algodv2, Indexer } from "algosdk";

// TODO shared wallet connect
// TODO shared client and indexer

export function loadCompiledQVotePrograms(): {
    approval: Uint8Array;
    clearState: Uint8Array;
} {
    return { approval: qvApprovalProgram, clearState: qvClearProgram };
}

export function loadCompiledQueuePrograms(): {
    approval: Uint8Array;
    clearState: Uint8Array;
} {
    return { approval: queueApprovalProgram, clearState: queueClearProgram };
}

export function decodeBase64(s: string) {
    return Buffer.from(s, "base64").toString();
}

export function decodeValue(v: { bytes: string; type: number; uint: number }) {
    return { ...v, bytes: Buffer.from(v.bytes, "base64").toString() };
}

// TODO split this in two methods, generic readGlobalState in utils, and processState in QVote 
export async function readGlobalQVoteState(
    client: Algodv2,
    address: string,
    index: number
): Promise<QVoteState> {
    // NOTE decimalPlaces is a temporary hack, until the contracts handle decimal points
    const accountInfoResponse = await client.accountInformation(address).do();
    const div = 10; // divide by this for 1 decimal place precision
    for (let i = 0; i < accountInfoResponse["created-apps"].length; i++) {
        if (accountInfoResponse["created-apps"][i].id == index) {
            const app = accountInfoResponse["created-apps"][i];
            const rawState: { [key: string]: any } = app["params"][
                "global-state"
            ].reduce((acc, { key, value }) => {
                const decodedKey = decodeBase64(key);
                const decodedValue =
                    decodedKey == "Name" ? decodeValue(value) : value;
                acc[decodedKey] = decodedValue;
                return acc;
            }, {});
            const formattedState: QVoteState = {
                options: Object.entries(rawState)
                    .filter(([key, value]) => key.startsWith(OPTION_SYM))
                    //@ts-ignore
                    .map(([key, value]) => ({
                        title: key,
                        value: (value.uint - 2 ** 32) / div,
                    })),

                decisionName: rawState.Name.bytes,
                votingStartTime: rawState.voting_start_time.uint,
                votingEndTime: rawState.voting_end_time.uint,
                assetID: rawState.asset_id.uint,
                assetCoefficient: rawState.asset_coefficient.uint,
            };

            return formattedState;
        }
    }
    console.log(
        "QVote decision not found. Is the creator correct? Has the decision been deployed?"
    );
}

export async function readGlobalQueueState(indexer: Indexer, appID: number){
    const appData = await indexer.lookupApplications(appID).do();
    return appData;
}

export async function readLocalStorage(client, userAddress, appID) {
    const accountInfoResponse = await client
        .accountInformation(userAddress)
        .do();
    for (let i = 0; i < accountInfoResponse["apps-local-state"].length; i++) {
        if (accountInfoResponse["apps-local-state"][i].id == appID) {
            const state =
                accountInfoResponse["apps-local-state"][i][`key-value`];
            return state.map(({ key, value }) => ({
                key: decodeBase64(key),
                value,
            }));
        }
    }
}

/*
 * returns a function that takes an appID parameter, and when executed returns a tx that adds the options passed
 */
export function buildAddOptionTxFunc(
    creatorAddress: string,
    params: any,
    options: string[]
): (a: number) => Transaction {
    const appArgs = [ADD_OPTION_SYM].concat(options).map(encodeString);
    return (appID: number) =>
        algosdk.makeApplicationNoOpTxn(creatorAddress, params, appID, appArgs);
}

export const waitForConfirmation = async (algodclient, txId) => {
    const status = await algodclient.status().do();
    let lastRound = status["last-round"];
    for (let x = 0; x < 999; x++) {
        const pendingInfo = await algodclient
            .pendingTransactionInformation(txId)
            .do();
        if (
            pendingInfo["confirmed-round"] !== null &&
            pendingInfo["confirmed-round"] > 0
        ) {
            //Got the completed Transaction∑
            console.log(
                "Transaction " +
                    txId +
                    " confirmed in round " +
                    pendingInfo["confirmed-round"]
            );
            break;
        }
        lastRound++;
        await algodclient.statusAfterBlock(lastRound).do();
    }
};

export function encodeString(s: string): Uint8Array {
    return new Uint8Array(Buffer.from(s));
}

export function encodeNumber(n: number): Uint8Array {
    return new Uint8Array([n]);
}

export function intToByteArray(num: number, size: number): Uint8Array {
    let x = num;
    const res: number[] = [];

    while (x > 0) {
        res.push(x & 255);
        x = x >> 8;
    }

    const pad = size - res.length;
    for (let i = 0; i < pad; i++) {
        res.push(0);
    }

    return Uint8Array.from(res.reverse());
}

export function pad(options: string[]): string[] {
    if (options.length > 5) {
        throw "You passed more than 5 options at the same time to be padded. You can't do that. ";
    }
    for (let i = 0; options.length < 5; i++) {
        options.push(NULL_OPTION_SYM);
    }
    return options;
}

export function groupOptions(options: string[]): string[][] {
    const out = [];
    options.map((d, i) => {
        i % 5 == 0 && out.push([]);
        out[out.length - 1].push(d);
    });
    out[out.length - 1] = pad(out[out.length - 1]);
    return out;
}
