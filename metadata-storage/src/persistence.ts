import {Connection, createConnection} from "mysql";
import {SecretsManager} from "@aws-sdk/client-secrets-manager";

export class PersistenceManager {
    private connection?: Connection = undefined

    constructor(readonly secret: string) {
    }

    async init(): Promise<any> {
        return new Promise<Connection>((async (resolve, reject) => {
            if (!this.connection) {
                let secretsManager = new SecretsManager({})
                let secret = await secretsManager.getSecretValue({
                    SecretId: this.secret
                }).then((res) => JSON.parse(res.SecretString!))

                this.connection = createConnection({
                    host: secret.host,
                    port: secret.port,
                    user: secret.username,
                    password: secret.password,
                    database: secret.dbname
                })
            }
            resolve(this.connection)
        }))
    }

    async save(imagePath: string, isBeer: boolean, style?: string): Promise<any> {
        return new Promise(((resolve, reject) => {
            if (!this.connection) {
                reject(new Error('Must call init first'))
                return
            }
            this.connection.query(
                'INSERT INTO things (image_path, is_beer, style) VALUES (?, ?, ?)',
                [imagePath, isBeer, style || ""],
                (err, results, fields) => {
                    if (err) {
                        reject(err)
                        console.error('Problem inserting into DB', err.stack)
                    }
                    resolve(results)
                })
        }))
    }
}