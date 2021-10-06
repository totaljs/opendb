mkdir -p .bundle

cd .bundle
cp -a ../controllers/ controllers
cp -a ../definitions/ definitions
cp -a ../schemas/ schemas
cp -a ../public/ public
cp -a ../views/ views

# cd ..
total4 --bundle opendb.bundle
cp opendb.bundle ../opendb.bundle

cd ..
rm -rf .bundle
echo "DONE"