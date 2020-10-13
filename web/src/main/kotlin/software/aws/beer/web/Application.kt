package software.aws.beer.web

import com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.jdbc.DataSourceBuilder
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Component
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.multipart.MultipartFile
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.model.PutObjectRequest
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient
import javax.sql.DataSource


private val OBJECT_MAPPER = jacksonObjectMapper().disable(FAIL_ON_UNKNOWN_PROPERTIES)

@SpringBootApplication
class Application

fun main(args: Array<String>) {
    runApplication<Application>(*args)
}

interface EnvironmentConfiguration {
    val cdnHostname: String
    val databaseSecretArn: String
    val uploadBucket: String
}

@Controller
class IndexController(private val store: Storage, private val configuration: EnvironmentConfiguration) {
    @GetMapping("/")
    fun getThings(model: Model): String {
        model.addAttribute("title", "Things!")
        model.addAttribute("cdn", configuration.cdnHostname.trimEnd('/'))
        model.addAttribute("things", store.getThings())
        return "things"
    }
}

@Controller
class FileUploadController(private val s3Client: S3Client, private val configuration: EnvironmentConfiguration) {
    @PostMapping("/upload")
    fun upload(@RequestParam file: MultipartFile): ResponseEntity<String> {
        s3Client.putObject(
                PutObjectRequest.builder()
                        .bucket(configuration.uploadBucket)
                        .key(file.originalFilename)
                        .contentType(file.contentType)
                        .contentLength(file.size)
                        .build(),
                RequestBody.fromInputStream(file.inputStream, file.size)
        )
        return ResponseEntity.ok().build()
    }
}

data class Thing(val isBeer: Boolean, val imagePath: String, val style: String? = null)

interface Storage {
    fun getThings(): List<Thing>
}

@Configuration
class DatabaseConfiguration {

    @Bean
    fun databaseDetails(secretsManagerClient: SecretsManagerClient, config: EnvironmentConfiguration): DatabaseDetails {
        val secret = secretsManagerClient.getSecretValue { it.secretId(config.databaseSecretArn) }.secretString()
        return OBJECT_MAPPER.readValue(secret)
    }

    @Bean
    fun dataSource(databaseDetails: DatabaseDetails): DataSource {
        return DataSourceBuilder.create()
                .driverClassName("com.mysql.cj.jdbc.Driver")
                .url("jdbc:mysql://${databaseDetails.host}:${databaseDetails.port}/${databaseDetails.dbname}")
                .username(databaseDetails.username)
                .password(databaseDetails.password)
                .build()
    }
}

@Configuration
class AwsConfiguration {
    @Bean
    fun s3Client(): S3Client = S3Client.create()

    @Bean
    fun secretsManager(): SecretsManagerClient = SecretsManagerClient.create()
}


@Component
object DefaultConfiguration : EnvironmentConfiguration {
    override val cdnHostname = System.getenv("CDN_DOMAIN")

    override val databaseSecretArn = System.getenv("DB_SECRET")

    override val uploadBucket = System.getenv("UPLOAD_BUCKET")
}

data class DatabaseDetails(val engine: String,
                           val host: String,
                           val port: Int,
                           val dbname: String,
                           val username: String,
                           val password: String)
