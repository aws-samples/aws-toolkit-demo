package software.aws.beer.web.storage

import org.springframework.data.repository.NoRepositoryBean
import org.springframework.data.repository.Repository
import java.io.Serializable

@NoRepositoryBean
interface ReadOnlyRepository<T, ID: Serializable> : Repository<T, ID> {

    fun findOne(id: ID): T

    fun findAll(): List<T>
}