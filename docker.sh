echo "BUILDING"
docker-compose build

echo "TAGGING"
docker tag opendb_web totalplatform/opendb:latest

echo "PUSHING"
docker push totalplatform/opendb:latest

echo "DONE"