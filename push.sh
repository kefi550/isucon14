#!/bin/bash

set -eu

LOCAL_PATH="."

for i in $(seq 1 3); do
  host="isu${i}"
  echo $host
  rsync -avr --exclude='node_modules' "${LOCAL_PATH}/webapp/nodejs/" ${host}:~/webapp/nodejs/ 
  rsync -avr "${LOCAL_PATH}/env.sh" ${host}:~/env.sh 
  ssh ${host} 'bash -l -c "sudo logrotate -f /etc/logrotate.conf; sudo systemctl restart isuride-node;"'
done

