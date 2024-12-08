#!/bin/bash

set -u

LOCAL_PATH="."

mkdir -p ${LOCAL_PATH}/webapp/nodejs/
rsync -avr isu1:~/webapp/nodejs/ "${LOCAL_PATH}/webapp/nodejs/"

