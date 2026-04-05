# 本地运行（SaaS MVP）

## 作用
这是“可销售版本”的第一版：登录、多租户隔离、公司预设、印章上传、商品库、领收书保存/发送、月/年收入汇总。

## 运行路径
在目录执行：`D:\Business\WebProjects\线上开领収书\saas`

## 命令
1. 安装依赖
```bash
npm install
```
2. 启动服务
```bash
npm start
```
3. 打开
- 登录页: `http://localhost:8787/login.html`
- 应用页: `http://localhost:8787/app.html`

## 关键说明
- 数据文件: `saas/data/db.json`
- 印章上传目录: `saas/uploads`
- 领收书状态: `saved` / `sent`
- 汇总口径: 仅统计 `sent` 且按 `receipt_date` 归属月份/年份
