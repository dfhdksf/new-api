测试备份脚本的数据是否正常
删除已有数据库:drop database `new-api`;
创建数据库
docker exec -it mysql mysql -uroot -p \
-e 'CREATE DATABASE IF NOT EXISTS `new-api` CHARACTER SET utf8mb4;'

导入sql
docker exec -i mysql mysql \
-uroot -p'密码' \
--database=new-api \
< /home/ubuntu/1/database.sql \
&& echo "数据库导入成功"

