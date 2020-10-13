package software.aws.beer.web.storage

import org.jetbrains.exposed.dao.IntEntity
import org.jetbrains.exposed.dao.IntEntityClass
import org.jetbrains.exposed.dao.id.EntityID
import org.jetbrains.exposed.dao.id.IntIdTable
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.transactions.transaction
import org.springframework.stereotype.Component
import software.aws.beer.web.Storage
import software.aws.beer.web.Thing
import javax.sql.DataSource

@Component
class DatabaseStorage(private val dataSource: DataSource) : Storage {
    override fun getThings(): List<Thing> {
        return transaction(Database.connect(dataSource)) {
            addLogger(StdOutSqlLogger)
            ThingDao.all().mapLazy { Thing(it.isBeer, it.imagePage, it.style) }.toList()
        }
    }
}

private object ThingsDao : IntIdTable("things") {
    val imagePath = varchar("image_path", 255)
    val isBeer = bool("is_beer")
    val style = varchar("style", 50)
}

class ThingDao(id: EntityID<Int>): IntEntity(id) {
    companion object : IntEntityClass<ThingDao>(ThingsDao)
    var imagePage by ThingsDao.imagePath
    var isBeer by ThingsDao.isBeer
    var style by ThingsDao.style
}
