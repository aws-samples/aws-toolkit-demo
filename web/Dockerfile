FROM gradle:6.6.1-jdk11 as buildCache
WORKDIR /app
ENV GRADLE_USER_HOME /cache
COPY *.gradle.kts ./
RUN gradle --no-daemon build --info --stacktrace || echo 'done'

FROM gradle:6.6.1-jdk11 as builder
WORKDIR /staging
COPY --from=buildCache /cache /home/gradle/.gradle
COPY . .
RUN gradle bootJar --info --no-daemon

FROM amazoncorretto:11
COPY --from=builder /staging/build/libs/web.jar /home/web.jar
EXPOSE 80
CMD java -jar -Dserver.port=80 /home/web.jar