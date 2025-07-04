// live-etl-websocket/index.ts
import postgres from "postgres";
import { env } from "#/env";
import { sleep, type ServerWebSocket } from "bun";
import { getListId, getListUser, parseListOperation, validatePrimaryListOp, getENSProfileFromAddress } from "./efp";

export async function setupDbClient() {
    const client = postgres(env.DATABASE_URL, {
        publications: 'global_publication',
        types: {
            bigint: postgres.BigInt
        }
    })

    try {
        client.subscribe(
            'events',
            async (row, { command, relation }) => {
                try {
                    await handleEvent(row)
                } catch (err) {
                    console.error('[POSTGRES] Error handling event:', err);
                }
            },
            () => {
                console.log(`Connected to EFP Global Publication`)
            },
            () => {
                console.error('[POSTGRES] Subscription error occurred.');
                retryConnection();
            }
        );
    } catch (err) {
        console.error('[POSTGRES] Initial subscription setup failed:', err);
        retryConnection();
    }
}

let retryTimeout: ReturnType<typeof setTimeout> | null = null;

function retryConnection() {
    if (retryTimeout) return;
    retryTimeout = setTimeout(() => {
        retryTimeout = null;
        console.log('[POSTGRES] Retrying subscription...');
        setupDbClient();
    }, 5000);
}

async function startHeartbeat() {
    const response = await fetch(`${env.HEARTBEAT_URL}`)
    const text = await response.text()
    console.log(`Heartbeat registered`)
    let heartbeat = 0
    for (;;) {
        await sleep(1000)
        console.log(`waiting for events...`)
        heartbeat++
        if (heartbeat > 300 && env.HEARTBEAT_URL && env.HEARTBEAT_URL !== 'unset') {
            // call snitch
            try {
                const response = await fetch(`${env.HEARTBEAT_URL}`)
                const text = await response.text()
                console.log(`Heartbeat registered`)
                heartbeat = 0
            } catch (err) {
                console.log(`Failed to register heartbeat `)
            }
        }
    }
}

setupDbClient()
startHeartbeat()

interface WebSocketData {
    address: string;
}
  
const clients = new Set<ServerWebSocket<WebSocketData >>();

// WebSocket server
Bun.serve({
    port: 3100,
    fetch(req, server) {
        const url = new URL(req.url);
        let address = url.searchParams.get('address'); 
        if (!address) {
            address = "0x0000000000000000000000000000000000000000"
        }
        server.upgrade(req, {
            data: { address },
        });
        if (server.upgrade(req)) return;
        return new Response('WebSocket only', { status: 400 });
    },
    websocket: {
        open(ws: ServerWebSocket<WebSocketData>) {
            console.log('[New Client] subbed to:', ws?.data?.address);
            clients.add(ws);
        },
        close(ws) {
            clients.delete(ws);
        },
        message(ws, message) {
            console.log('Received message:', message);
        },
    },
});

function broadcast(notification: string, topic: `0x${string}`): void {
    for (const client of clients) {
        const subbedAddress = client.data?.address;
        if(subbedAddress.toLowerCase() === topic || subbedAddress === "0x0000000000000000000000000000000000000000") {
            client.send(notification);
        }
    }
}

async function transformToNotification(row: any, operator: string, operatorListId: bigint|null): Promise<string> {
    const parsedListOp = parseListOperation(row?.event_args?.op);
    const ensProfile = await getENSProfileFromAddress(operator.toLowerCase() as `0x${string}`);
    const notification = {
        address: operator,
        name: ensProfile?.name || null,
        avatar: ensProfile?.avatar || null,
        token_id: operatorListId?.toString() || null,
        action: parsedListOp.recordTypeDescription,
        opcode: parsedListOp.opcode,
        op: row.event_args.op, 
        tag: parsedListOp.tag || null,
        updated_at: row.updated_at,
    }
    return JSON.stringify(notification);
}

async function handleEvent(row: any): Promise<void> {
    console.log('[POSTGRES] New Event')
    if(row.event_name !== 'ListOp') {
        return
    }
    const operator = await getListUser(row?.event_args?.slot, row?.chain_id, row?.contract_address)
    const operatorListId = await getListId(operator)
    
    const validPrimaryListOp = await validatePrimaryListOp(row, operatorListId);
    if (!validPrimaryListOp) {
        return;
    }
    const notification = await transformToNotification(row, operator, operatorListId);
    const parsedListOp = parseListOperation(row?.event_args?.op);
    const topic = parsedListOp?.recordAddress.toLowerCase() as `0x${string}`;
    broadcast(notification, topic)
}


