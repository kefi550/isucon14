#!/bin/bash

set -u

LOCAL_PATH="."

mkdir -p ${LOCAL_PATH}/webapp/nodejs/
rsync -avr isu1:~/webapp/nodejs/ "${LOCAL_PATH}/webapp/nodejs/"

for i in $(seq 1 3); do
  host="isu${i}"
  mkdir -p ${LOCAL_PATH}/${host}/etc/systemd/system/
  rsync -avr ${host}:/etc/hosts "${LOCAL_PATH}/${host}/etc/"
  rsync -avr ${host}:/etc/systemd/system/isuports.service "${LOCAL_PATH}/${host}/etc/systemd/system/"
  mkdir -p ${LOCAL_PATH}/${host}/etc/mysql/
  rsync -avr ${host}:/etc/mysql/ "${LOCAL_PATH}/${host}/etc/mysql/"
  mkdir -p ${LOCAL_PATH}/${host}/etc/nginx/
  rsync -avr ${host}:/etc/nginx/ "${LOCAL_PATH}/${host}/etc/nginx/"
  mkdir -p ${LOCAL_PATH}/${host}/etc/logrotate.d/
  rsync -avr ${host}:/etc/logrotate.d/ "${LOCAL_PATH}/${host}/etc/logrotate.d/"
done

