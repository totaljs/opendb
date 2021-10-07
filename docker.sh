echo "BUILDING"
docker-compose build

echo "TAGGING"
docker tag opendb_web totalplatform/opendb:beta

echo "PUSHING"
docker push totalplatform/opendb:beta

echo "DONE"