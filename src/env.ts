export function raise(error: unknown): never {
	throw typeof error === "string" ? new Error(error) : error;
}

export const env = Object.freeze({
    ACCOUNT_METADATA: getEnvVariable("ACCOUNT_METADATA"),
    DATABASE_URL: getEnvVariable("DATABASE_URL"),
    ENS_WORKER_URL: getEnvVariable("ENS_WORKER_URL"),
    LIST_REGISTRY: getEnvVariable("LIST_REGISTRY"),
    BASE_RPC_URL: getEnvVariable("BASE_RPC_URL"),
    OP_RPC_URL: getEnvVariable("OP_RPC_URL"),
    ETH_RPC_URL: getEnvVariable("ETH_RPC_URL"),
    HEARTBEAT_URL: getEnvVariable("HEARTBEAT_URL"),
});

function getEnvVariable<T extends keyof EnvironmentVariables>(name: T) {
    return process.env[name] ?? raise(`environment variable ${name} not found`);
}
