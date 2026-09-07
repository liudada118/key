# Key Manager 业务逻辑图

## 业务总览
- 核心对象
	- 用户账号
	- 客户
	- 合同
	- 在线密钥
	- 离线密钥
	- 传感器类型
	- 设备心跳
	- 设备报码
	- 用户反馈
	- 审计日志
- 核心角色
	- 超级管理员
	- 管理员
	- 子账号
	- 外部设备客户端
- 核心闭环
	- 创建客户
	- 创建合同
	- 生成密钥
	- 客户端激活
	- 心跳续验
	- 异常处置
	- 审计追踪

## 主业务闭环
```mermaid
flowchart TD
	start["业务开始"] --> login["后台登录"]
	login --> role{"角色权限"}

	role -->|超级管理员| allScope["全局数据域"]
	role -->|管理员| teamScope["本人和下级数据域"]
	role -->|子账号| selfScope["本人数据域"]

	allScope --> customer["客户管理"]
	teamScope --> customer
	selfScope --> customer

	customer --> contract["合同管理"]
	contract --> keyGen["生成授权密钥"]
	keyGen --> deliver["交付客户/设备"]
	deliver --> activate["设备激活校验"]
	activate --> heartbeat["设备心跳上报"]
	heartbeat --> monitor["后台监控"]

	monitor --> normal{"状态正常?"}
	normal -->|是| continueUse["继续使用"]
	normal -->|否| handle["异常处置"]

	handle --> suspend["暂停"]
	handle --> renew["续期"]
	handle --> revoke["吊销"]
	handle --> clearTamper["清除异常"]
	handle --> reissue["重新签发"]

	suspend --> audit["写入审计"]
	renew --> audit
	revoke --> audit
	clearTamper --> audit
	reissue --> audit
	continueUse --> audit
```

## 账号权限
- 登录入口
	- 本地账号密码
	- OAuth 回调
	- Session Cookie
- 权限分层
	- 公开接口
		- 密钥验证
		- 密钥激活
		- 服务时间
		- 传感器列表
		- 反馈提交
	- 登录用户
		- 查看个人数据域
		- 创建客户
		- 创建合同
		- 生成密钥
		- 查看密钥
	- 管理员
		- 管理下级账号
		- 暂停密钥
		- 恢复密钥
		- 吊销密钥
		- 续期密钥
		- 查看心跳
	- 超级管理员
		- 全量账号
		- 全量审计
		- 传感器类型
		- RSA 密钥对
		- 密钥类型变更
- 数据域
	- 超级管理员看全部
	- 管理员看本人和下级
	- 子账号看本人
	- 部分账号按传感器分组过滤

## 账号权限图
```mermaid
flowchart LR
	user["请求用户"] --> auth{"是否登录"}
	auth -->|否| publicOnly["只允许公开接口"]
	auth -->|是| active{"账号启用?"}
	active -->|否| forbidden["拒绝访问"]
	active -->|是| role{"角色"}

	role --> super["super_admin"]
	role --> admin["admin"]
	role --> sub["user"]

	super --> all["全局数据"]
	admin --> children["本人 + 下级"]
	sub --> own["本人数据"]

	all --> procedure["业务操作"]
	children --> procedure
	own --> procedure
	publicOnly --> publicApi["公开校验/反馈"]
```

## 客户合同流程
- 客户管理
	- 创建客户
	- 编辑客户
	- 禁用客户
	- 删除客户
	- 删除前检查活跃密钥
- 合同管理
	- 创建合同
	- 合同编号唯一
	- 绑定客户
	- 设置数量额度
	- 设置合同状态
	- 删除前检查关联密钥
- 合同状态
	- 草稿
	- 生效
	- 过期
	- 终止
- 密钥归属
	- 绑定客户
	- 绑定合同
	- 记录合同编号
	- 记录创建人

## 在线密钥流程
```mermaid
flowchart TD
	input["填写授权参数"] --> validate["校验参数"]
	validate --> sensor["选择传感器类型"]
	validate --> days["设置有效天数"]
	validate --> category["选择密钥类型"]
	validate --> customer["选择客户"]
	validate --> contract["选择合同"]

	sensor --> generate["生成密钥字符串"]
	days --> generate
	category --> generate
	customer --> save["写入 licenseKeys"]
	contract --> save
	generate --> save

	save --> output["返回密钥"]
	output --> customerDeliver["交付客户"]
	customerDeliver --> clientCheck["客户端校验"]
	clientCheck --> decode{"能否解码"}
	decode -->|否| invalid["INVALID"]
	decode -->|是| dbCheck["查询数据库记录"]
	dbCheck --> status{"数据库状态"}

	status -->|ISSUED| activate["首次激活"]
	status -->|ACTIVATED| valid["继续有效"]
	status -->|SUSPENDED| suspended["拒绝使用"]
	status -->|REVOKED| revoked["拒绝使用"]
	status -->|TAMPERED| tampered["拒绝使用"]
	status -->|EXPIRED| expired["拒绝使用"]

	activate --> valid
	valid --> response["返回授权信息"]
	suspended --> response
	revoked --> response
	tampered --> response
	expired --> response
	invalid --> response
```

## 密钥生命周期
- 初始状态
	- `ISSUED`
	- 未激活
	- 有到期时间
	- 有创建人
- 使用状态
	- 首次校验激活
	- 写入激活时间
	- 绑定设备信息
	- 返回剩余天数
- 管理状态
	- 暂停
	- 恢复
	- 续期
	- 吊销
	- 清除异常
	- 重新签发
- 终止状态
	- 过期
	- 吊销
	- 异常
- 历史记录
	- 状态变更
	- 操作人
	- 原因
	- 时间
	- 审计日志

## 密钥状态机
```mermaid
stateDiagram-v2
	[*] --> ISSUED: 生成
	ISSUED --> ACTIVATED: 首次有效校验
	ISSUED --> EXPIRED: 到期
	ACTIVATED --> EXPIRED: 到期
	ACTIVATED --> SUSPENDED: 暂停
	SUSPENDED --> ACTIVATED: 恢复
	ACTIVATED --> RENEWED: 续期
	RENEWED --> ACTIVATED: 继续使用
	ACTIVATED --> REVOKED: 吊销
	ISSUED --> REVOKED: 吊销
	ACTIVATED --> TAMPERED: 时间回拨/篡改
	TAMPERED --> ACTIVATED: 清除异常
	TAMPERED --> REVOKED: 重新签发并吊销旧密钥
	REVOKED --> [*]
	EXPIRED --> [*]
```

## 客户端校验流程
- 服务时间
	- `/serverTime`
	- 返回服务器毫秒时间
	- 客户端校时参考
- 在线校验
	- `/licenseCheck`
	- 校验密钥格式
	- 解码授权载荷
	- 查询数据库状态
	- 检测到期
	- 检测暂停
	- 检测吊销
	- 检测异常
	- 首次使用激活
- 传感器同步
	- `/sensorTypes`
	- 返回分组列表
	- 返回扁平列表
	- 返回 value-label 映射
- 反馈提交
	- `/feedback`
	- 公开提交
	- 内容截断
	- IP 记录
	- 后台处理

## 防篡改流程
```mermaid
flowchart TD
	check["客户端校验"] --> report["上报 clientTime / tamper"]
	report --> serverNow["服务器时间"]
	serverNow --> compare{"是否异常"}
	compare -->|否| normal["维持原状态"]
	compare -->|时间回拨| mark["标记 TAMPERED"]
	compare -->|客户端上报篡改| mark
	mark --> deny["拒绝授权"]
	mark --> reason["记录异常原因"]
	mark --> list["进入异常列表"]
	list --> admin{"管理员处置"}
	admin --> clear["清除异常"]
	admin --> reissue["重新签发"]
	admin --> revoke["吊销旧密钥"]
```

## 离线密钥流程
- 生成条件
	- 机器码
	- 传感器类型
	- 有效天数
	- RSA 密钥对
- 签发过程
	- 获取活跃 RSA 密钥
	- 生成离线激活码
	- 写入离线密钥记录
	- 返回激活码
- 客户端验证
	- 使用公钥
	- 校验 RSA-SHA256 签名
	- 校验机器码
	- 校验到期时间
- 后台管理
	- 离线密钥列表
	- 离线密钥统计
	- RSA 密钥对列表
	- 生成新 RSA 密钥对

## 设备心跳流程
```mermaid
sequenceDiagram
	participant Device as 设备客户端
	participant API as heartbeat.ping
	participant DB as 数据库
	participant Admin as 后台监控

	Device->>API: keyString + deviceCode + version
	API->>DB: 查询密钥
	DB-->>API: 密钥状态
	API->>API: 判断暂停/吊销/异常/过期
	alt 授权有效
		API->>DB: 写入心跳
		API-->>Device: authorized=true
	else 授权失效
		API-->>Device: authorized=false + reason
	end
	Admin->>API: 查看心跳列表
	API->>DB: 查询 keyHeartbeats
	Admin->>API: 查看丢失设备
	API->>DB: 按阈值查询超时设备
```

## 设备报码流程
- 设备类型
	- 足部设备
	- 座椅设备
	- 虚拟设备
- 读取记录
	- 插槽编号
	- 插槽名称
	- MAC 地址
	- 成功状态
	- 合同编号
	- 创建人
- 列表查看
	- 按数据域过滤
	- 按设备类型过滤
	- 分页查看
- 删除规则
	- 记录存在
	- 超级管理员可删全部
	- 非超管只能删本数据域

## 反馈处理流程
```mermaid
flowchart TD
	submit["外部提交反馈"] --> validate["校验内容"]
	validate --> type["归类类型"]
	type --> save["写入 feedback"]
	save --> list["后台反馈列表"]
	list --> scope["按数据域过滤"]
	scope --> status["处理状态"]
	status --> pending["pending"]
	status --> processing["processing"]
	status --> resolved["resolved"]
	status --> closed["closed"]
	processing --> remark["填写处理备注"]
	resolved --> archive["完成归档"]
	closed --> archive
```

## 审计规则
- 写入场景
	- 导出密钥
	- 创建合同
	- 更新合同
	- 删除合同
	- 暂停密钥
	- 恢复密钥
	- 吊销密钥
	- 续期密钥
	- 清除异常
	- 重新签发
- 审计字段
	- 用户 ID
	- 用户名
	- 动作类型
	- 资源类型
	- 资源 ID
	- 描述
	- IP
	- User-Agent
- 查看权限
	- 超级管理员

## 业务边界
- 删除客户
	- 检查客户是否存在
	- 检查活跃密钥数量
	- 有活跃密钥则阻止
- 删除合同
	- 检查合同是否存在
	- 检查数据域权限
	- 检查活跃密钥数量
	- 有活跃密钥则阻止
- 管理账号
	- 管理员不能创建管理员
	- 管理员只能操作下级
	- 非超管不能操作超管
- 导出密钥
	- 按数据域过滤
	- 按条件过滤
	- 写入审计日志
- 反馈处理
	- 按数据域过滤
	- 管理员可删除
	- 子账号只能处理范围内反馈

## 页面到业务映射
- `Home`
	- 密钥统计
	- 异常提醒
	- 快捷入口
- `GenerateKey`
	- 在线密钥生成
	- 客户合同绑定
- `KeyList`
	- 密钥查询
	- 生命周期管理
	- 导出
- `VerifyKey`
	- 密钥解码
	- 有效性验证
- `OfflineKeyGen`
	- 离线激活码
	- RSA 签名
- `OfflineKeyList`
	- 离线记录
	- 离线统计
- `CustomerManagement`
	- 客户资料
	- 客户删除约束
- `ContractManagement`
	- 合同资料
	- 合同删除约束
- `HeartbeatMonitor`
	- 心跳列表
	- 丢失设备
- `TamperedKeys`
	- 异常密钥
	- 清除异常
	- 重新签发
- `AuditLog`
	- 操作审计
- `FeedbackManagement`
	- 反馈处理
