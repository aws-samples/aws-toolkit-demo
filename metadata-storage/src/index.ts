import {SNSEvent} from "aws-lambda"
import {PersistenceManager} from "./persistence";

const SECRET = process.env.DB_SECRET!
const connectionManager = new PersistenceManager(SECRET)

export const handler = async (event: SNSEvent): Promise<any> => {
    await connectionManager.init()
    for (const record of event.Records) {
        let msg = record.Sns.Message
        console.log(msg)
        let thing = JSON.parse(msg)

        await connectionManager.save(thing.thumbName, thing.isBeer, thing.style)
    }
}