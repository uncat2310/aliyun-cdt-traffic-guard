#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Alibaba Cloud CDT Traffic Guard - Standalone Scheduled Guard Script
Intended to run periodically via Linux Crontab (e.g. every minute) to monitor CDT usage
and automatically shut down / start up ECS instances based on quota threshold.
"""

import os
import sys
import json
import logging
from logging.handlers import RotatingFileHandler

from aliyunsdkcore.client import AcsClient
from aliyunsdkcore.request import CommonRequest
from aliyunsdkecs.request.v20140526 import StartInstancesRequest, StopInstancesRequest, DescribeInstancesRequest

# ================== 1. 基础配置 ==================
# 可在此处填写或通过环境变量传入
ACCESS_KEY_ID = os.getenv("ALIYUN_AK", "YOUR_ALIYUN_ACCESS_KEY_ID")
ACCESS_KEY_SECRET = os.getenv("ALIYUN_SK", "YOUR_ALIYUN_ACCESS_KEY_SECRET")
REGION_ID = os.getenv("ALIYUN_REGION", "cn-hongkong")
ECS_INSTANCE_ID = os.getenv("ALIYUN_INSTANCE_ID", "i-yourinstanceid12345")

# 流量保护阈值 (GB)
TRAFFIC_THRESHOLD_GB = float(os.getenv("TRAFFIC_THRESHOLD_GB", "180.0"))

# 日志配置
LOG_FILE = os.getenv("GUARD_LOG_FILE", "/var/log/traffic_guard.log")
LOG_FORMAT = "%(asctime)s - %(levelname)s - %(message)s"

logging.basicConfig(
    level=logging.INFO,
    format=LOG_FORMAT,
    handlers=[
        RotatingFileHandler(LOG_FILE, maxBytes=10 * 1024 * 1024, backupCount=2, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("TrafficGuard")


# ================== 2. 初始化阿里云客户端 ==================
try:
    client = AcsClient(ACCESS_KEY_ID, ACCESS_KEY_SECRET, REGION_ID)
    logger.info("Aliyun AcsClient initialized successfully.")
except Exception as e:
    logger.error(f"Failed to initialize AcsClient: {e}")
    sys.exit(1)


# ================== 3. 查询当月 CDT 流量 ==================
def get_total_traffic_gb(acs_client):
    request = CommonRequest()
    request.set_domain('cdt.aliyuncs.com')
    request.set_version('2021-08-13')
    request.set_action_name('ListCdtInternetTraffic')
    request.set_method('POST')

    try:
        response = acs_client.do_action_with_exception(request)
        response_json = json.loads(response.decode('utf-8'))

        total_bytes = sum(d.get('Traffic', 0) for d in response_json.get('TrafficDetails', []))
        total_gb = total_bytes / (1024 ** 3)

        logger.info(f"当月CDT流量使用: {total_gb:.2f} GB")
        return total_gb
    except Exception as e:
        logger.error(f"获取CDT流量失败: {e}")
        sys.exit(1)


# ================== 4. 查询 ECS 实例状态 ==================
def get_ecs_status(acs_client, instance_id):
    try:
        request = DescribeInstancesRequest.DescribeInstancesRequest()
        request.set_InstanceIds([instance_id])
        response = acs_client.do_action_with_exception(request)
        response_json = json.loads(response.decode('utf-8'))

        instances = response_json.get("Instances", {}).get("Instance", [])
        if not instances:
            logger.error("未找到ECS实例信息")
            return None

        status = instances[0].get("Status")
        logger.info(f"ECS实例当前状态: {status}")
        return status
    except Exception as e:
        logger.error(f"获取ECS实例状态失败: {e}")
        return None


# ================== 5. ECS 启停控制 ==================
def ecs_start(acs_client, instance_id):
    status = get_ecs_status(acs_client, instance_id)
    if status == "Running":
        logger.info("ECS实例已经是运行状态，无需启动")
        return

    try:
        request = StartInstancesRequest.StartInstancesRequest()
        request.set_InstanceIds([instance_id])
        request.set_accept_format('json')
        response = acs_client.do_action_with_exception(request)
        logger.info(f"ECS启动响应: {response.decode('utf-8')}")
    except Exception as e:
        logger.error(f"启动ECS实例失败: {e}")


def ecs_stop(acs_client, instance_id):
    status = get_ecs_status(acs_client, instance_id)
    if status == "Stopped":
        logger.info("ECS实例已经是停止状态，无需再次停止")
        return

    try:
        request = StopInstancesRequest.StopInstancesRequest()
        request.set_InstanceIds([instance_id])
        request.set_ForceStop(False)
        request.set_accept_format('json')
        response = acs_client.do_action_with_exception(request)
        logger.info(f"ECS停止响应: {response.decode('utf-8')}")
    except Exception as e:
        logger.error(f"停止ECS实例失败: {e}")


# ================== 6. 主逻辑 ==================
def main():
    total_gb = get_total_traffic_gb(client)

    if total_gb < TRAFFIC_THRESHOLD_GB:
        logger.info(f"流量 {total_gb:.2f} GB < 阈值 {TRAFFIC_THRESHOLD_GB:.2f} GB，保持运行/启动ECS")
        ecs_start(client, ECS_INSTANCE_ID)
    else:
        logger.info(f"流量 {total_gb:.2f} GB ≥ 阈值 {TRAFFIC_THRESHOLD_GB:.2f} GB，触发超额自动关机")
        ecs_stop(client, ECS_INSTANCE_ID)

    logger.info("流量守卫检测执行完毕")


if __name__ == "__main__":
    main()
