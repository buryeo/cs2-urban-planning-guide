# CS2 Urban Planning Guide / 城区规划向导

一个面向《都市：天际线 2》新手的 Mod 构想：通过可返回、可修改的分步向导，在空白城区规划出顺应地形、有道路层次和街区变化的路网，并在操作中学习城市规划。

> **当前状态：概念与社区反馈阶段，已有 [River Delta 浏览器交互原型](prototype/README.md)。没有可下载、可安装的 Mod，也没有游戏内实现。** 我们会根据反馈决定首个游戏内原型的范围。

## 想解决的问题

游戏自带道路工具足够灵活，但新玩家面对一片空地时，常常只会重复方格或完全对称的布局。这个项目希望给出一份可编辑的初稿，解释每个规划建议的理由，并让玩家看到修改对连通性、街区尺度和地形适应性的影响。

## 设想中的体验

1. **选择规划范围**：在一张空白城区地图上圈定区域，查看示意等高线、水岸、主导风向、候选航道和外部道路入口。
2. **摆放城区节点**：在地图上摆放可拖动、可缩放的大圈，作为 CBD、陆地交通枢纽、航空枢纽、海运枢纽、工业区、资源采集区、四个居住中心、两个公园区、旅游景点区、大学城和科研中心的初始位置；可增删或调整。工业区初始建议位于设定风向的城市中心下风侧，资源采集区靠近工业区，海运枢纽靠近候选航道。
3. **生成片区**：将大致节点转成连续的片区轮廓，河流切开陆地区块；拖动中心或调整影响范围时边界随之变化。
4. **安排主要连接**：预览各片区之间及通往地图入口的主通道，调整走线和过河位置。
5. **生成街区道路**：根据片区、主通道和地形生成不同方向与密度的街道，再调整街块大小和局部形态。
6. **检查并落地**：查看断头路、绕行、坡度和道路衔接提示，确认后才在游戏里铺路。

在任一步都可以返回修改。重新生成时保留玩家锁定的节点和走线，其他部分随之更新。教学提示放在操作旁边，说明「为什么推荐这里」以及「这次修改带来了什么变化」。

这些**大圈**只表示节点的大致位置和影响范围，可重叠。下一步生成的**片区轮廓**是可调整的规划草图，不是正式行政区或不可变的用地分区。两个公园区是两个独立的初始圈，不预设必须临水；旅游景点区、大学城和科研中心各有独立的圈。**街块**是后续道路围出的更小空间；游戏中的具体居住、商业等分区要到更细尺度再决定。

## 首次验证范围

- 目标场景：游戏自带 **River Delta** 地图中的一片空白城区。
- 第一轮验证：节点圆圈建议与编辑、片区轮廓生成与调整、主通道预览、街区道路变化，以及返回上一步后的预览更新。
- 暂不承诺：对已建成城区自动改造、自动拆迁、交通仿真结果或任何发布日期。

详细设计见 [设计稿](docs/superpowers/specs/2026-09-23-cs2-urban-planning-guide-design.md)。

想先看交互效果，可运行 [River Delta 原型](prototype/README.md)：调整示意风向、拖动节点、查看自动生成的片区轮廓、切换大画布、锁定跨河走线和调整街区道路密度。地图的水系、等高线、风向和航道仍是概念示意，不是游戏导出的真实地图数据。

## 邀请反馈

欢迎通过 [Issues](https://github.com/buryeo/cs2-urban-planning-guide/issues/new/choose) 分享意见。尤其想知道：

- 对新手而言，哪一步最需要引导？
- 你希望先摆放哪些节点圆圈？哪些节点应该由地图推荐？
- 哪些提示能帮你学会规划，哪些会打断游戏？
- 你愿意用哪种地图或空白地块测试首个原型？

请把它作为**设计提案**来评议，不要将其当成现有 Mod 的故障反馈。

## 参考依据

- [《都市：天际线 2》官方地图介绍](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/maps-themes)：River Delta 的河流、缓坡与平地特征。
- [ITDP TOD Standard](https://tod.itdp.org/tod-standard/tod-standard-framework.html)：步行、连通、公共交通与混合使用等规划原则。
- [自然资源部《关于加强国土空间详细规划工作的通知》](https://www.cgs.gov.cn/zcwj/202304/t20230415_820770.html)：规划单元承接功能布局、空间结构及设施等要求。
- [联合国人居署《可持续社区规划五原则》](https://unhabitat.org/sites/default/files/documents/2019-05/five_principles_of_sustainable_neighborhood_planning.pdf)：混合用地可以落实在城市、社区、街块与建筑等多个尺度。
- [Interactive Procedural Street Modeling](https://peterwonka.net/Publications/pdfs/2008.SG.Chen.InteractiveProceduralStreetModeling.pdf)：用方向场引导不同街道形态的研究。

---

**English summary:** A proposed beginner-friendly, step-by-step planning guide for *Cities: Skylines II*. It would suggest editable city nodes, major connections, and local street layouts based on terrain, while teaching planning concepts through immediate feedback. This repository is collecting feedback; no playable mod exists yet.
