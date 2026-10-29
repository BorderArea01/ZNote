# ZNote 项目长期约定与验收记录

## 普通抖音作品被空文章字段误判与近期补采（2026-10-30）

- 用户要求补回近期失败采集。最新7条失败中，3条Pixiv来源在原目标库后来已有2/4/2张、文件存在，跳过重投并保留旧失败历史；4条抖音此前均因普通作品携带空article_info而报文章编号不匹配。这是文章适配回归，不能归咎于用户链接或平台验证。
- extractDouyinArticle先核对文章路由/type163/同作品有效文章体信号，普通视频/图集/实况中的空对象、零ID和关联文章占位返回非文章；真实文章仍严格核对作品ID与完整正文。24项文章/平台/队列回归及384MiB生产构建通过，资产不变。先保存160KiB采集状态和原解析器备份，确认采集/导入/导出/备份/收件器空闲后，经原计划任务加载3741 PID310276；保留0.0.0.0监听、原collector/PIN与所有网络/EasyTier。
- 通过原Cloudflare任务retry恢复3条抖音，保留本机与云端ID、目标知识库和分组设置：新增5张图片+2段实况视频及3段配乐，媒体和配乐文件SHA256/字节均核对。原始恢复证据artifacts/recent-recovered-r1NgeC、配乐证据artifacts/recent-capture-recovery/bgm-verified.json。
- 剩1条原任务两次重试仍无匿名资源；另查桌面note入口跳转jingxuan且没有目标作品数据，保留真实失败，不拼接媒体、不伪报成功、不移除原记录。第二轮证据artifacts/recent-recovered-Z4tyey。3条Pixiv已存在内容没有重复下载，未触碰其原文件。
- 当前实际图库桌面与390模拟触屏对7个媒体逐个解码，2段视频静音播放、关闭通过，14次UI检查与遮挡媒体的截图已目视，证据artifacts/capture-recovery-ui-crsMYN。播放进度写入在隔离浏览器中截获，未修改用户历史；没有荣耀真机操作。所有临时本地/云授权已撤销，补采成果完整保留。

## Paw 页面现有预览图也可整组入库（2026-10-30）

- 用户明确要求保存已有预览图；不能因没有原图链接就拒绝保存。主扩展0.9.43在作品figure中收集未链接的img.pawchive.pw/st /thumbnail/data/图片，已有原图仍优先；过滤推荐/头像/压缩包/伪造主机并去重，保留顺序与来源，不拼接受限原图地址。此轮只改浏览器扩展，未更改手机服务端解析。
- 每页preview_indexes由解析器经票据传递，任务区和入库备注标注网页预览图，混合画质逐页标注；仍按作品成组，失败不堵后续、重试不重复。已覆盖原安装目录C:/Users/31093/Downloads/clipper，ID/连接/任务保留；用户Edge需重载扩展并刷新来源页。
- 受控扩展生产构建、原图/预览/混合/安全过滤适配UI、4项票据/分组回归通过。原安装扩展对当前3741完成5张合成预览图分组，注入1项503其余4项照常保存、重试补齐，逐字节hash/640×480/组序/来源/画质备注核对；桌面与390触屏收起/恢复/Escape、实际知识库5张缩略图与主图解码通过并目视。证据artifacts/paw-preview-live-Xa3mcC/result.json；首轮验收误等ZoomViewer选择器，改为实际detail-dialog，临时数据均清理；未将用户引用作品下载或实际入库。
- 当前3741 health正常，无服务或网络重启，PIN未变，临时库/文件/两类临时授权已清理；没有实际操作用户已打开的Edge或手机，不冒称真机验收。

这份文件记录跨会话仍然有效的产品要求、用户偏好和容易回归的问题。它不是临时任务清单；完成具体任务后仍要回到真实运行实例验证。


## 抖音长文章采集（2026-10-29）

- 用户询问 /article/ 链接能否保存。原采集器只识别 video/note/slides，移动UA把文章重定向到/home，通用抖音兜底还把页面当视频。桌面初始SSR也只有加载壳，实际正文在匹配aweme/detail的article_info.article_content.markdown，不能存摘要或壳页面后报成功。
- 新capture-douyin-article.js按来源、aweme_id和article_id匹配；读取完整Markdown、article_title和作者，has_more=true、摘要无正文、格式错误与编号不符均拒绝。canonical article URL使用桌面UA，跳离原文章明确失败；既有短时匿名浏览器识别article路由与正文就绪，不降到video路径、不收推荐内容、不执行原文脚本。
- 长文章固定保存图文笔记，正文内图片沿原顺序归档；不受手机/扩展默认group导致纯文字失败，也不把正文塞进图片备注。原视频/图组/实况行为保持，正文图片仍遵守笔记100张上限。新模块不增加前端或Android权限。
- 6项文章专项、采集/DNS/DoH/云协议54项回归和下载解析兼容的11项增量复查通过（存在交叉，不能相加当独立用例数）；384MiB生产构建通过，前端资产不变。确认队列/导入/导出/备份空闲后，经原计划任务重启3741至PID276360，health正常；没有修改网络、系统DNS、Clash、EasyTier或PIN。
- 真实来源在当前实例完成两次临时库验收：Cloudflare Android设备令牌协议、原安装目录0.9.42扩展的采集当前作品按钮；扩展页面为隔离入口夹具，后端独立读真实文章，不冒称实际原站按钮页面已测。两次都与原API提供的3780字符Markdown全文一致，标题/作者/出处保留。桌面与390模拟触屏看到首末段、来源并可关闭，四张截图已目视，证据 artifacts/douyin-article-live-AQP1kj/result.json。
- 临时本机/云任务、两个笔记、知识库与自身授权均精确清理，原PIN和用户先前入库的三个抖音视频+配乐保留。首次验收脚本给扩展用了管理员session令牌，被已有跨站保护拒绝；改用独立write/API临时令牌后通过，未放宽CSRF。手机与扩展不用换包；没有荣耀真机现场操作。

## 采集系统 DNS 之外的 DoH 备用（2026-10-29，已部署）

- 用户核对当前网卡为211.136.192.6/114.114.114.114后，明确同意「系统解析→腾讯DoH→CloudflareDoH」。旧版只重试同一系统解析，三条最新抖音任务仍在读取分享/跳转页时CAPTURE_DNS_FAILED，不能声称上次的三次重试根治故障。
- server/capture-doh.js 使用固定HTTPS主机与TLS校验，腾讯doh.pub直连启动IP1.12.12.12/120.53.53.53，Cloudflare沿用现有代理或直连启动IP1.1.1.1/1.0.0.1；不先靠故障的系统DNS解析备用主机。系统三次各1.5秒+300/900ms，之后各家DoH共享3.5秒预算；A/AAAA保留、取消立即结束、迟到结果不覆盖。DNS恢复后在原操作内继续，完全失败结束该项并让队列继续。
- DoH响应<=64KiB，核对Question/类型/响应码/CNAME归属，不跟随HTTP跳转；所有IP仍由原下载器校验，混合私网地址不换DNS绕过。局域网名称不发公共DNS；只缓存备用成功地址，<=256域名、<=TTL/60秒，系统健康优先。日志capture_dns只含域名、解析器、错误码、耗时，无分享全文/令牌。说明 docs/CAPTURE-NETWORK.md。
- 66项DNS/DoH/图片传输/代理/浏览器解析/采集队列/图组/云租约/漫画回归和384MiB生产构建通过，资产仍index-BttyyFfS.js/index-DvAVnJAr.css。真实备用验收在独立解析器强制系统失败，腾讯332ms恢复；再强制腾讯失败，Cloudflare619ms恢复；三条实际抖音读出完整视频候选，证据 artifacts/capture-doh-live-js6ie1。没有故障注入到Windows或正在运行的服务。
- 确认采集、导入、导出、备份空闲及连接器无在途后，经原ZNote-Server计划任务加载新服务PID304736，3741监听0.0.0.0，原Cloudflare连接器继续运行。系统DNS/Clash/EasyTier/网络均未修改，手机和扩展无需换包；完整图库远程访问不属于这次变更。
- 用户已授权恢复三条失败作品，经它们原云端任务retry，保持本机/云端ID和目标库，均completed并保存视频+配乐：原文件3163336/3175869/2238379字节，14.5/15.2/13.134秒，核对SHA256、Range206、来源和单一原任务。当前真实DNS健康时的入库与模拟系统故障的DoH验证分开陈述，不能说生产任务当时必然使用了备用。证据 artifacts/capture-doh-recovery-S6FON7/result.json；第一次脚本错误地向公开条目API索取未公开hash，修正为只读DB核对，保留已保存视频并接续后两条，没有重复下载首条。
- 当前实例三段视频在桌面与390模拟触屏实际解码、播放、拖动进度、关闭及云端成功状态通过；验收禁止额外UI写入，播放记录写入在隔离浏览器中截获以保留用户观看历史。截图已目视；原PIN未改、自身本地/云临时授权已撤销，用户新入库视频与配乐完整保留。没有荣耀真机现场操作，不称为手机真机验收。

## 浏览器局域网优先与云端备用（2026-10-29）

- 主网页采集扩展 0.9.42 增加独立 remoteServer/remoteToken，本机授权与手机授权不混用。每次操作前用同一 1.2 秒预算检查本机 health 和 write/admin 授权；可用时不访问云端，不可用时仅新作品链接选择 Pages。用户取消不触发回退；写入后响应不确定不得换队列重投。
- captures/imports 逐任务记录原入口，恢复本机后仍查原云队列；远程视频解析按链接转 captures。云端只传链接、选库、分组、标签及幂等号，剥离浏览器 HTML/作品数据，不发送本机令牌、Cookie 或文件。截图、正文附件、原图/视频上传、服务器下载解析仍需直连；私有独立扩展未增加此能力。
- 设置页提供备用授权、移除入口，移除只清除此浏览器的备用配置。Pages 邀请页与已登录首页都提供「连接浏览器扩展备用」；仅可信点击消费一次性邀请并签发独立设备 token，预览/GET 不消费。Worker 只准固定主扩展 Origin 携独立 Bearer 写入，其他跨站请求和扩展 cookie-only 写入仍拒绝。
- 当前登记浏览器扩展共三项；Paw 属主扩展内的站点适配。catalog/addon.json 与 addons list/check/build/pack 集中管理，浏览器启停/重载及独立扩展设置仍分开。不能声称现有 Pages 收件箱支持完整图库浏览。
- 验证：23项定向接口回归、保存方式/框选截图鼠标触屏、隔离选路与邀请授权 UI 通过；真实3741+正式Pages+现有collector分别直连和云端落盘，核对原文件哈希，恢复直连仍查原云任务。原安装目录已覆盖自己的运行文件并保留原公钥/存储；已打开Edge尚需用户重载扩展和刷新网页，未宣称用户浏览器已重载或授权。
- 证据 artifacts/clipper-routes-ui-TaFfME、artifacts/page-tools-dock-t7BYfm 与 artifacts/clipper-routes-live-ln2rn6；真实验收清理最初被验收脚本自己未读完的扩展ZIP下载阻塞，先清理自己的残留，修正为读完响应体再请求维护清理，并留60秒覆盖维护等待；不为此改用户服务。临时凭据和测试条目均清理、PIN未改；正式Pages部署 f683e411，安卓beta.24下载保持。没有改动任何网络/EasyTier，也未启动完整图库公网服务。

## Android 完整采集面板与书签拖动（2026-10-28）

- 用户要求完整采集窗沿用已选小展开 A 风格、收起/拖离保留 B 书签风格；拖动要跟手，书签下端要尖。另指出键盘弹出后整个大窗被裁切、需要滚动找按钮。不能只改小菜单，不能拿编译成功当作手势和键盘验收。
- ShareActivity/FloatingShareActivity 使用 CaptureVisuals 统一面板底色、边框、字段、主按钮与向量图标；316dp 宽、内容自适应，选库菜单深色，加载时显示明确状态。底部并排读取剪贴板/前往知识库；不重新导入素材，不改变后台任务、选库记忆和局域网优先协议。
- 标题/关闭和底部保存操作独立于中间表单 ScrollView；短屏仅中间滚动。键盘出现时临时收起图集方式与链接说明行，压缩输入高度，关闭键盘恢复原选择。浮动 Dialog 在 Android30+ 也可能缩小却不报告 Type.ime；同时检查 visibleDisplayFrame，不能只按 SDK>=30 假定 Insets 完整。实测需同时核对输入、当前选库、保存和关闭在键盘上方，而非只核对保存按钮。
- 页签拖动起始距离取系统 slop 与4dp较小值，保留2dp轻抖点击；首个MOVE只更新把手/窗口，不走全表单 render/measure，同一事件只提交一次窗口更新；记录 drag_frame，不把 UiAutomation 同步注入/读树耗时冒充应用绘制耗时。取消、多指主指离开均结束拖动，不误触展开；吸附140ms、保留系统关闭动画设置。
- B页签保持24×48dp触摸区，15×38dp可见占屏，底部改为全宽9dp深V剪口并取消贴边时底角圆弧；成功/失败色点上移，不能掉进透明剪口。拖离仍恢复48dp完整Z按钮，左右贴边与位置记忆保留。
- 本地受控离线构建release/debug/测试APK与lint通过（512MiB堆/单worker/无持久daemon），原签名与10024核对；隔离Android30原签名beta.23→beta.24覆盖升级保留安装权限。原生触屏覆盖6dp启动/2dp点击、拖动取消/左右吸附、选库/关闭/帮助/空输入、后台成功失败与浏览入口、1.3字体、真实IME窗口与横屏固定操作区，截图逐张目视。最终拖动MOVE到绘制24/16/51ms；不等于荣耀真机输入延迟。证据 artifacts/android-overlay-local-YrkDXm/。
- 局域网/远程分享采集回归通过：各提交一次、真实隔离服务落盘一张、LAN阶段零云请求、超时/授权失效/恢复和凭据隔离；证据 artifacts/android-route-local-qQtmPS/，credentialLeaks=0。Android30首次包替换广播可能在启用测试无障碍后又解绑服务；验收夹具先等待am wait-for-broadcast-idle，保留系统事件诊断，不为测试竞态修改产品权限。
- 当前3741服务仍为原PID306732、health正常，无需重启知识库/连接器；没有操作真实手机或任何网络/EasyTier。发布继续使用本机原签名APK、递增版本、GitHub Release与Pages固定下载入口，交付前核对远端提交和公开APK哈希。荣耀Android15真机手感/系统键盘仍未代验。
- beta.24已发布：原签名versionCode10024，源码提交1ca9404，GitHub手机更新REST目录已可见；Pages正式域名APK与源码ZIP逐字节核对通过（artifacts/cloudflare-release-live-4v7EnB/），APK SHA256 a680a6a1ab9a29be11c9f3f6c1145d5563d2d57cffb52f44e854772f398f3a7e。Pages Worker哈希与更新前一致，原D1采集队列/连接器仍运行。

## 手机公网采集第一次失败的 DNS 修复（2026-10-27，已部署）

- 用户反馈采用Cloudflare后，手机首采常失败、再次才成功。已核对真实云队列、本机mobile_captures_v1和server.stderr.log：近期四条抖音/小红书/B站失败都正常入云并被开发机领取，实际错误分别是getaddrinfo ENOTFOUND www.iesdouyin.com、b23.tv、xhslink.cn、www.bilibili.com。连接器日志另有ECONNRESET，下一轮恢复且保留任务，不能把它当作这些平台任务失败的直接原因；也不能无证据声称手机提交失败或Cloudflare丢单。
- 新server/capture-dns.js统一网页、图片、视频及配乐解析。仅对ENOTFOUND/EAI_AGAIN/解析超时等DNS错误最多尝试三次，间隔300/900ms，每次等待最多4秒；取消立即结束等待并忽略迟到结果。原任务继续运行，不新建分享、不重新投递写请求、不重复入库；私网地址检查、全部地址验证和每次跳转的直连固定地址保留。持续失败返回明确DNS错误，认证、404、平台验证、封禁和文件大小不靠无差别重试掩盖。没有更改系统DNS、代理、网络连接或EasyTier。
- 53项不重复的DNS/图片传输/代理/采集平台/云队列/租约与漫画边界检查通过（DNS本身11项，含首次失败恢复、持续失败有界、取消、迟到拒绝、私网拒绝、403不重试、原任务单次入库）。日志artifacts/albums/capture-dns-regression.log、capture-dns-platform-regression.log、capture-dns-final-regression.log。384MiB受控生产构建通过，主前端资产仍index-BttyyFfS.js/index-DvAVnJAr.css。
- 确认无采集/导出/导入/备份在途后，经原ZNote-Server计划任务重启3741至PID306732，监听0.0.0.0；原Cloudflare连接器仍运行。未改Android或云协议，既有beta.23直接使用服务端修复，无需重装APK或重新配对。
- tests/cloudflare-inbox-live.mjs --live --source-job=274e82b8-6853-4e21-a4f8-7da81b55ea50仅复制这条原DNS失败分享链接到自身临时库，真实Pages→原连接器→当前3741完成网页提交与Android设备令牌协议提交，共2张真实图片，并核对首张原文件hash一致；桌面/390触屏看到本轮自己的completed结果，截图已目视。证据artifacts/cloudflare-inbox-live-2gYTP3/result.json。当前真实DNS在测试时可达，首次故障恢复由显式单测注入；无荣耀手机现场操作，不能把协议/触屏验证称作真机验收。
- 临时本地/云任务、库、媒体、授权全部精确清理；原四库、PIN与12角色资料哈希保持。用户在修复期间另提交了一条真实小红书视频，云任务51da15ff-5361-49f4-ac15-9796e233f7bf已completed，新增3762904字节原件完整保留，所以最终资源数17200而非更新前17199，不能为让计数相等删除这条用户内容。历史失败记录未擅自重投，避免与用户后来的成功采集重复。最终核对artifacts/capture-dns-deployed.json，收件器空闲、两端health正常。
- 真实云验收必须等待自己POST /api/captures的202响应，记录自己任务ID/目标库，并等待本轮对应行完成；已有用户任务时，“页面出现任意job/任意completed”会产生竞态与虚假通过。失败清理需按自己目标库查漏云记录，不能只依赖尚未收到的提交响应；首轮脚本遗留的唯一测试失败云记录已按确切ID/临时库/时间核对后清理。源码在tests/cloudflare-inbox-live.mjs保留修正。

## 浏览器采集入口靠边缩小（2026-10-25，扩展0.9.41）

- 用户要求浏览器页面上的常驻采集入口平时靠边缩小，减少遮挡。复用page-tools.js统一入口，不增加第二个浮窗：默认左右边缘24×48px的Z页签，点击展开；拖动页签或把手、靠边松手吸附收起，展开时可自由移动。缩小后也可沿边上下拖动；离边拖动中用完整圆角，取消拖动恢复原锚点。原pageToolsPosition扩展可选edge，兼容旧x/y并校验合法方向，不新开权限或重置设置。
- 手动「收起并靠边」/Esc，或移开鼠标闲置四秒自动缩小；菜单、键盘焦点及视频/图片预览使用中不自动收起。收起不取消后台任务；页签状态点保留忙/完成/失败，展开看原完整结果。触屏窗口移动后Chrome可能不发兼容click，静止触屏在pointerup激活，忽略同次后续click；拖动/取消不能误触展开。保留框选截图隐藏/恢复、黑名单、单一保存方式及原进度逻辑。
- 192MiB受控扩展生产构建和固定ID/清单校验通过。普通网页采集/选库、实际阶段与配图计数、后台保存及链接去重、鼠标/触屏拖动、框选及扩展弹窗关闭后截图、像素不含工具栏、取消/令牌缺失恢复/黑名单/320边界回归通过，证据artifacts/page-tools-unified-3BRfWM/；X本帖采集、后台空响应/协议不匹配、去重、提示关闭、视频面板避让、扩展重载恢复通过，证据artifacts/page-tools-kbXDTt/。这些采集解析使用隔离测试服务，不冒称任意真实平台作品都已验证。
- 已覆盖原安装目录C:/Users/31093/Downloads/clipper的page-tools.js/page-actions.js并仅提高manifest到0.9.41，固定公钥/ID、其余已安装修复和连接凭据保持。安装目录在独立Edge桌面与模拟触屏上下文连接实际3741选库，检查默认页签/左右吸附/拖动取消/刷新记忆/键盘Enter与Esc/闲置收起/菜单和视频面板保护/缩小提示保留/黑名单恢复/320边界，证据artifacts/page-tools-dock-e7McRo/result.json，截图已目视；反馈阶段为显式注入，不伪称真实任务成功。原PIN未变，临时令牌已精确清理。
- 当前3741的/api/clipper/download即时提供0.9.41，新脚本与源码和安装目录逐字节一致，证据artifacts/page-tools-dock-release.json；无需重启服务器或更新APK。原用户Edge未启用远程调试，没有强行重启；用户须在扩展管理点重新加载ZNote，再刷新已打开网页，才能替换那些标签中的旧脚本。未验证荣耀真机。原扩展三个小文件保留于本地artifacts/page-tools-dock-install-1792929413480/用于回滚。

## 角色设定集 A＋B 双视图（2026-10-25，用户已选定并部署）

- 用户看过四版方案后明确选择“第一第二种都不错，可以都采纳，然后可切换”。正式私人插件1.2.0采用 A 分区画廊与 B 角色档案；顶部切换，不能重新退回仅演示/待选状态，也不能擅自替换成C/D。A按分栏纵向分区、响应式卡片网格；B桌面为分栏目录＋角色列表＋就地档案，手机列表→档案→返回。公开虚构资料演示保留在 https://znote-capture-inbox.pages.dev/design/character-layouts/ ，选型说明 docs/design/character-layouts/README.md。
- 两种视图共用原作品/角色/分栏/排序/素材/附件与保存逻辑，不复制或重新导入；保留原知识库启停归属。切换保留当前作品、搜索、分栏筛选与角色；localStorage按知识库记忆视图，按知识库＋作品记忆角色焦点。筛选排除当前档案时显示提示及清除筛选，不能静默跳角色。档案列表自动滚到当前角色，上传或关系编辑期间锁定视图/列表切换，提供取消恢复。
- 私人源码、构建、样式、验收继续全部集中被Git忽略的 plugins/character-studio/，不强制提交。CharacterViews.jsx与views.css复用原CharacterDetail；原HelpHint/Select/草稿/CAS保留。画廊滚动区域及卡片同时设scroll-padding/scroll-margin，键盘焦点滚动后仍保留外框；仅fine指针轻微悬停抬升，减少动态效果时停用。
- 192MiB受控私人生产构建通过，当前3741扫描为1.2.0；所有白名单文件与实际响应逐字节一致，主资产仍index-BttyyFfS.js/index-DvAVnJAr.css，无后端重启或APK更新。真实实例双视图桌面/390触屏覆盖共享保存、筛选/焦点、重开记忆、图组引用/原件返回、附件、关系、草稿、409保留并重试、503重新加载、320边界和减少动画，证据 artifacts/character-studio/dual-1792916459670/result.json。原完整画廊工作流（桌面拖放/手机上下排序、分栏、自定义字段、封面、启停等）回归通过，证据 artifacts/character-studio/live-verified.json。
- 已对用户现有12张生肖卡只读检查两种真实布局、末卡打开/返回、键盘外框、短窗口与320/390触屏边界，禁止写请求并逐字比对角色状态与PIN未变；截图已目视。证据 artifacts/character-studio/existing-views-1792916447956/result.json。最终只保留用户一个scope、12卡，其他知识库/未分类默认关闭，无临时附件和测试库；部署核对 artifacts/character-studio/deployed-final.json。没有荣耀真机实测，不把触屏模拟称作真机通过。关闭重开角色插件加载新界面即可。

## Mangapill 漫画章节采集（2026-10-25）

- 用户提供的 Mangapill /chapters/9552-10001000/...-chapter-1 真实有74页；原通用Readability遗漏data-src懒加载图片，不能把无配图文字保存当作整章成功。server/capture-comic.js扩展现有章节解析，只取chapter-page内picture img.js-page，优先data-src，保留DOM阅读顺序和完整URL，核对每页page i/N计数、缺图/重图/地址协议，单章最高200页；缺页明确失败，不跟随下一章、不收广告/目录封面。默认图片组，章节名、页数和出处进入备注。
- 原CDN cdn.readdetectiveconan.com直接下载返回403；已有安全图片下载器仅对该精确主机加公开Referer https://mangapill.com/ 后返回原图200。每次跳转重算头部，不向其他域名或伪装后缀转发；DNS公共地址验证、大小/超时/单次重试沿用原实现。参考成熟MangaPill源的懒加载页列表机制，自有解析实现，不执行网页脚本或另建浏览器抓图链路。
- 16项漫画/缺页/域名/签名参数/失败续传/网络回归通过，384MiB生产构建通过；确认无在途采集/导出/备份后，经原计划任务重启3741至PID292480。主前端资产仍index-BttyyFfS.js/index-DvAVnJAr.css；服务端解析由手机和扩展共用，无需发布新APK或扩展包。
- tests/mangapill-capture-live.mjs --live在当前实际实例、安装目录C:/Users/31093/Downloads/clipper的0.9.40扩展及真实章节按钮执行完成：单组74页、索引0–73、无多余笔记，40391727字节；第1/37/74页与来源及media/original逐字节一致。桌面/390模拟触屏覆盖缩略图首中末跳转、原图解码、首尾边界、缩放、关闭、503图片重试和备注；最终截图已目视。证据artifacts/mangapill-live-WezrqM/result.json。临时库/任务/媒体/会话与API令牌已清理，原PIN/四个用户知识库/12角色卡未变；没有荣耀真机实测，不能称手机实机通过。
- 验收脚本参数limit必须<=100；同一初始hash在翻页后不一定再次触发导航，故障注入前要建立新文档并确认第1页。addInitScript设置localStorage应跳过about:blank，避免自身初始化异常污染产品pageerror。失败后可用显式--resume-library接续自身临时库，校验测试库名称及来源；--retain-on-failure仅保留明确测试数据供当轮修复，最终必须清理，不能重复整章下载来回避测试脚本问题。

## 插件按知识库启用与角色控件统一（2026-10-25，覆盖旧全局入口）

- 用户要求普通知识库不默认挂载创作插件。宿主入口只在具体库显示：无挂载时为简洁“插件设置”，有工具时为“知识库工具”；管理面板仅启停当前库。首页不提供全局工作台，切库按scope重新挂载，关闭/停用销毁iframe。用户已确认将既有12张角色卡迁入新建同名知识库，原ID/资料逐项核对一致；其他三个库和未分类默认关闭，未复制素材，迁移前保留小型JSON回滚资料（本地忽略目录）。
- 新协议所有API与iframe入口带collection参数（UUID或unfiled），settings使用plugin.library:<id>:<scope>独立保存enabled/version/data；启停推进版本，旧编辑冲突不覆盖。附件索引带可选collection_id，列表/下载/解析按库过滤，未分类为null；旧无参数全局状态接口兼容。legacy/claim用事务校验版本、目标为空，将旧资料和附件归属关联后清空旧状态，重复或覆盖返回409。备份恢复包含库绑定与附件；插件是可信同源代码，这不是安全沙箱。
- 私人角色插件1.1.0继续在被Git忽略的plugins/character-studio/维护。请求、草稿、当前作品缓存均按库区分；素材选择默认本库，可显式跨库引用，预览跨库原件后可回到原角色。统一Radix Select菜单，支持键盘/触屏/边缘避让；只有一个分栏显示当前标签，分栏与上下排序独立成行。编辑按身份/设定/自定义字段分节，分栏管理改为身份和排序双行卡片，素材/关系操作留白，320px表单双列改单列。已保存提示不拦截点击，编辑弹窗打开时隐藏，避免盖住标题和保存按钮。
- 轻量接口生命周期/CAS/权限/分库/未分类附件/原子迁移冲突/完整备份恢复通过；私人192MiB构建、网页384MiB生产构建通过。真实3741已重启为PID291264，主资产index-BttyyFfS.js/index-DvAVnJAr.css，插件所有白名单文件与磁盘逐字节一致，当前只保留一个用户scope、12张卡、无验收附件，原PIN不变。
- 当前实例桌面/390触屏完整编辑、真实135图组引用、封面/附件/关系、草稿、409保留并重试、启停重开通过（artifacts/character-studio/live-verified.json）。按库空白/切库卸载、真实12卡读取、扫描503恢复、键盘方向/Enter/Esc与焦点恢复、触屏外点关闭和320px边界通过（artifacts/character-studio/scopes-1792863914907/result.json）；悬停首尾/键盘外框/减少动画/短窗口通过（layout-1792863517239/result.json）。主内容72标签/收藏回归通过（artifacts/navigation-live-5ZsIL7/result.json），最终截图已目视，临时库/令牌已清理。没有Android原生改动或荣耀真机实测，刷新网页并重开插件加载。

## 只保留页面标签筛选与角色面板留白（2026-10-25，覆盖侧栏折叠标签方案）

- 用户明确移除左侧多标签筛选，主内容区已有的多标签筛选足够。Workspace 不再渲染侧栏 TagFilter，组件移除 sidebar 分支、样式和额外查询；保留主内容区搜索、全/任意匹配、多选、分页、选中条件与失败恢复。不要后续再添加重复侧栏标签入口。插件位置继续在内容分类下方。
- 私人角色插件1.0.2仍集中在被 Git 忽略的 plugins/character-studio/。分栏放宽至300px，卡片内容留白20px，列表上下/左右留白分别16/12px以容纳悬停与键盘外框；桌面主面板占满 iframe 可用高度，横向分栏、纵向各栏滚动，小屏单一页面滚动，320px转单列、常规手机双列。长角色名与编辑按钮改为正常流排布，不再使用绝对定位挤压。
- 悬停动画只对 hover＋fine 指针生效：短时抬升3px及边框/阴影过渡，不扩大卡片；触屏不遗留悬停，系统减少动态效果时停用位移/过渡/入场动画，不常驻 will-change。角色档案/编辑器用短时透明度和位移入场；原灰阶风格及用户阵营色保留。
- 真实3741实例对照旧CSS复现首卡上边界越过容器1px，新CSS悬停仍留13px、左右各12px。当前18角色3分栏验收覆盖首/尾卡、键盘外框、短窗口、320/390触屏、长名称、关闭及搜索恢复；证据 artifacts/character-studio/layout-1792861611787/result.json，截图已目视。截图需结束有限动画再拍，不能把中间帧的抽屉/淡入当作最终界面。
- 增大卡片后，两张卡可能无法同时完整显示；自动化不能先滚动源卡再滚动目标而误拖其他卡。私人完整回归改用当前可见卡片边缘进行真实鼠标拖拽，确认顺序持久化；桌面/模拟触屏原有设定、排序、草稿、135图组引用、附件、409重试及启停回归通过，证据 artifacts/character-studio/live-verified.json。
- 当前实例主内容72标签与移除侧栏筛选桌面/触屏回归通过，证据 artifacts/navigation-live-qVM42R/result.json；万标签分页/搜索/冲突恢复和2项标签/插件代码测试通过。受控192MiB私人插件构建、384MiB网页生产构建通过，实际3741服务仍PID296488，加载 index-503H0bF1.js/index-DwNv5iU9.css。原PIN和用户素材未变，临时验收资料/令牌已清理；无Android原生改动和荣耀真机验收。重载页面并重新打开插件加载新样式。

## 局域网优先与手机远程备用（2026-10-25，Android beta.23）

- 用户要求局域网可用时手机不经过 Cloudflare Pages。ConnectionRoutes / CaptureSessionProvider 复用已保存并授权的 LAN 地址（含旧版 previous_origin），后台直连检查真实 /api/health 与本机采集授权；可用时直接访问本机，不把“有 Wi-Fi”当作可达证据。不可达、错误服务或授权失效时，新链接才回退到已配置的远程入口；本地探测绕过系统 HTTP 代理，凭据严格按 origin 隔离。
- App 连接/回到前台和首次提交新任务前重新选择线路，保留编辑输入/弹窗，不自动丢弃当前编辑。每条任务固定提交时的入口，查询、重试不跨队列；升级前旧任务保留原配置来源。图片和视频原文件不投递远程链接收件箱，手动配置的完整公网服务仍保留原上传能力。开发机收件连接器仍保持原轮询；不能宣称整套系统零云端请求。仅远程配对过的手机先连接并登录局域网地址一次。
- beta.23 / versionCode10023 使用原发布 keystore，本机受控 Gradle release/Lint/debug/test APK 均通过，原证书 SHA-256 4e42f079d9ac5c4154a53eaa3ea6a82720ddc8be3ad3c9f84d0bea7abc62101b。继续采用本机受控构建＋原签名＋GitHub Release 与 Pages 静态下载的方法，不触发已禁用的 Actions。签名脚本使用 pwsh7 读取 DPAPI；不要改签名或找用户索要原 keystore。
- 隔离 Android30 实际触屏、HTTP 入库、断开/恢复/401/错误服务/超时/凭据隔离验收通过，LAN 阶段零远程请求，真实临时库新增一张测试图片；beta.22 → beta.23 原签名覆盖升级保留 installer app-op。证据 artifacts/android-route-local-OEHybf/。无荣耀真机实测，不能说真机通过。
- 验收曾发现旧 WebView 解析 Vite 默认现代语法报 Unexpected token '=' 而白屏；vite.config.js 指定 chrome80 编译目标后，实际原生 WebView 已显示局域网登录页。该选项转换语法，不代表所有现代浏览器 API 均有 polyfill。测试必须检查实际页面显示，不能只检查顶部线路标签或 URL。

- beta.23 已发布到 GitHub android-v0.10.0-beta.23 与固定 Pages 下载入口，源码提交 f885d126ef4a194edc2439fe55614d4ed3b245bd。公开 APK/source 重新下载并与签名产物校验一致，证据 artifacts/cloudflare-release-live-khfEPJ/result.json；APK SHA-256 155fa0f65cb31292dc33a499a0c7dfc06fb009fa8a9908439d6dd82685cfef21。GitHub 草稿按标签 REST 查询可能暂时404，先用 GraphQL 读取 databaseId，再按ID操作和核对 releaseAssets.digest，不重复创建。Wrangler Pages 禁止 --config 自定义路径；从 data/cloudflare-collector/pages-deploy/ 工作目录执行、自动读取 wrangler.json，通过环境提供 account_id，不使用含 account_id 的旧 jsonc，不修改根 package/Vite 文件。

## 默认收藏与侧栏插件入口（2026-10-25，覆盖自定义相册旧需求）

- 用户撤销自定义收藏项功能，只保留默认收藏：移除相册选择、管理、目标弹窗及 album 筛选。卡片/预览直接切换星标，多选恢复收藏所选/取消收藏。完整组通过服务器版本与成员快照原子更新，不拆组；详情正文不被摘要响应覆盖。数据库历史结构和备份恢复兼容保留，不清除素材。
- 创作插件入口移至内容分类下、知识库列表与标签区之前，不能再放在多标签筛选下方。侧栏标签默认收起，展开后搜索当前库所有标签、每页40项且列表限高；跨页/搜索/失败/收起保留已选条件。手机侧栏连续选标签时不自动关闭，主内容标签区可独立收起。
- 界面默认使用通用中性配色，尤其私人角色插件1.0.1采用灰阶背景、边框与按钮，不以大面积绿色制造风格；用户自选阵营色仍可保留。插件源码、构建与验收继续只在被 Git 忽略的 plugins/character-studio/ 维护。以后新增插件界面沿用中性或宿主主题。
- 当前3741实例桌面与390px触屏已验证：72标签搜索/分页/多选保留、503重试、收藏冲突恢复、整组收藏/取消与批量收藏、无自定义相册入口、插件位置和横向边界；证据 artifacts/navigation-live-YWWX8N/result.json。私人插件桌面/触屏编辑、排序、引用真实135图组、附件、草稿、409恢复、停用/启用通过，证据 artifacts/character-studio/live-verified.json；截图已目视，验收临时资料/令牌清理且PIN不变。
- 收藏/标签/插件与备份兼容8项代码测试及万标签浏览器分页回归通过。网页静态构建直接由现有3741服务加载，无后端行为变更，不为前端更新重置PIN或停止在途任务。旧网页需重新加载。不能把桌面触屏模拟说成荣耀真机通过。

## 本地角色设定插件与热插拔宿主（2026-10-24）

- 用户要求知识库内可选角色卡插件，面向小说创作者：复用已有图片、视频、图片组、视频组、笔记和附件，按作品、阵营等自定义分栏，不重新导入，不改动原素材。实际旧机制只有外部 API/浏览器扩展，不能声称已有内置页面热插拔。
- 新的通用宿主是 server/local-plugins.js、src/LocalPlugins.jsx；私人插件 character-studio 1.0.0 的源码、构建、清单和验收脚本集中在 plugins/character-studio/，整个 /plugins/ 被 Git 忽略，不可强制加入公开仓库。管理入口位于左栏“创作插件”旁拼图按钮，扫描/启停需管理员授权。插件只提供本地静态网页，不运行服务端插件脚本或安装命令；同源 iframe 属于可信代码，不能称为不可信代码沙箱。
- 支持空白作品、十二生肖/四象起始角色，阵营等分栏增删改及排序，人物设定、自定义字段、关系网络、封面、素材用途分区。桌面拖放与触屏上下移动/切换分栏并存。挂载选择器跨知识库搜索、分页和多选，整组引用由 kind＋collection_id＋group_key 标识；当前组成员顺序实时解析，删除/移组后明确显示不可用，不隐式复制。分组列表搜索同时匹配自动采集组标题。
- 状态/启停/附件索引复用 settings 的 plugin.state:/plugin.enabled:/plugin.files: 命名空间，状态写入使用版本 CAS，冲突不覆盖；保存失败保留编辑内容，未提交的角色草稿可恢复。附件流式上传最高200MB，独立保存一次，可重复引用；删除角色、作品、解除引用或停用都不删原件。文件下载强制 attachment，清单白名单与 realpath 阻断越界路径。
- 完整迁移ZIP、恢复快照均包含角色资料和插件附件，恢复会校验 SHA-256 并重新映射文件路径；硬链接快照沿用已有空间策略，不复制图库。插件源码另行复制；角色设定JSON只含文字/引用，不是完整附件备份。公共协议文档 docs/LOCAL_PLUGINS.md，不把私人实现搬进去。
- 16项插件生命周期/版本冲突/鉴权/引用、完整备份与恢复、空间策略/故障回滚回归检查通过。384MiB轻量生产构建通过，实际资产 index-YsMNEavT.js/index-DABvuJ-5.css。确认无在途采集/导出后通过原 ZNote-Server 任务更新服务到PID296488，0.0.0.0:3741，原任务启用/PIN保留。
- 当前实际实例桌面和390px模拟触屏均验证角色/分栏编辑、上下排序、同屏桌面拖放、未保存草稿恢复/丢弃、自定义字段、真实3图组引用与原预览/返回、封面、附件、人物关系、关闭重开、停用再启用、帮助提示边界、保存409时保留编辑并重试。已目视截图；验收作品/附件/临时令牌已清理，浏览记录写入在验收浏览器内拦截，避免污染用户记录。证据 artifacts/character-studio/live-verified.json。无Android/Gradle构建，未验证荣耀真机；不能把触屏模拟说成真机通过。

## B站《舞蹈基本功》补采与AVC优先（2026-10-21）

- 用户链接 b23.tv/3vVjyuM 指向 BV1GynB6JE7c；原失败任务3cd95df1-31cb-4a41-affb-4ce2398c5f6a使用另一短链zfd2KjO，但同一BV/第1P。原错误为下载后未发现预期完整MP4/WebM，并非已证明登录失败。干净链接、完整分享参数与实际原任务重试均成功，首次缺失输出原因未复现，不得擅自归因网络、参数或HEVC。
- 实际播放器验收发现默认选择HEVC 720p，有的浏览器只解出音频、videoWidth=0且不报error。同源同时提供AVC 720p。imports.js对已校验的B站视频优先原生avc1 MP4＋M4A，找不到AVC才保留旧格式兜底；其他平台策略不变，无重新编码、降分辨率或提高大小限制。
- 原任务已完成，原知识库同一卡片5a35f5e4-d54a-425a-91dc-5f883556c2f0现为1280×720、124.18秒、4,961,457字节AVC。只针对本轮补采生成的HEVC文件做CAS替换，核对原hash/版本，保留标题、作者、备注、来源、分组、收藏和知识库；旧文件及小型行快照留在本地用于回滚，没有复制整库或生成重复卡片。
- 9项格式选择、平台校验、视频采集/重试/去重/取消/恢复相关测试通过；384MiB轻量生产构建通过，前端资产仍index-DSR6IMg-.js/index-Be0_EwDp.css。确认无在途任务后通过原ZNote-Server计划任务维护重启到PID180892，0.0.0.0:3741，原自启状态已恢复，PIN未变。仅后端修改，不需更新APK或扩展。
- 当前实例原文件API长度/hash与库一致；桌面及模拟触屏检查实际详情、媒体加载和关闭，用同一媒体的静音克隆做解码/播放及60秒跳转，避免写入用户播放历史。截图遮蔽媒体且已目视检查，证据 artifacts/b23-dance/verified.json。未验证荣耀真机；不能用扩展/Android原生构建代替此例网页播放器验证。
- 原远程任务64f98a3a-0826-413c-85e4-5b5f7126ec59已是终态failed，连接器不再追踪，单独本机retry不会自动纠正手机记录。核对local_id后，只将这一条云端失败记录按既有retry语义重新排队，由原连接器观察本机completed并正常回传完成，无额外下载；证据 artifacts/b23-dance/cloud-verified.json。未放宽终态写入/租约或更改设备授权。

## 手机浮窗选定 A 展开＋B 页签（2026-10-21，Android beta.22）

- 用户明确选型：「展开版选用A，收起和小图标版选用B」。只落地展开小卡片、贴边短页签与拖离后的折角圆角Z方钮；不改App主界面，不再等待整套主题选择。
- CaptureAssistService沿用既有独立capture进程、授权、分享/剪贴板及任务轮询。同一原生窗口/面板复用；拖动中完整方钮48dp触区，松手180ms近侧吸边，贴边视觉15×38dp、触区24×48dp。异步选库/任务回调在拖动中不重设位置；取消拖动不误开。展开276dp宽，选库置顶，主采集居中，下方保留粘贴与前往知识库，菜单和小屏面板可滚动。
- CaptureVisuals使用原手写Z与统一矢量图标，不以字体/emoji替换结果。采集中自动收起，后台队列也显示细线状态，约21fps仅刷新小图形、空闲停止。成功短提示2300ms，失败4500ms后留标记；系统结果通知保留，不强行展开。结果状态统一切回主线程；取消只移除所属回调，不再误清除知识库加载回调。旧分享编辑页保留。
- Android 0.10.0-beta.22 / versionCode10022，原证书SHA256 4e42f079d9ac5c4154a53eaa3ea6a82720ddc8be3ad3c9f84d0bea7abc62101b。受控离线单worker512MiB构建release/Lint/debug/test APK通过，0 Lint errors、26项warnings；没有调用GitHub Actions。签名APK摘要 a086d56859921ff43b79f56df713ad67c99eceae6cdab7b0c0868404ccdbb30c。
- 隔离Android30模拟器覆盖实际窗口、触屏展开/关闭、拖动中完整形态、左右吸边、取消、记忆选库并传入提交、浮窗粘贴、后台排队/成功短提示收回、失败详情与下一次采集可用、前往知识库、大字体。证据 artifacts/android-overlay-local-Oz5gjU/result.txt，expanded/dragging/success/failure/large-font截图已目视。原签名beta.21→beta.22实际覆盖安装并保留既有安装app-op，证据 artifacts/android-overlay-local-Ij4gnN/release-upgrade.txt。
- 测试工具修正Android30不支持InputStream.readAllBytes、API30不能授予POST_NOTIFICATIONS、按钮尚未连接就被测试提前点击的问题。只复用本轮新建的隔离AVD重试，未连接或修改已有USB/Wi-Fi设备，退出清理所属模拟器。模拟任务不是平台解析验收；荣耀Android15真机及系统后台调度未验证，不能声称这台手机所有延迟已解决。
- beta.22 已发布 GitHub android-v0.10.0-beta.22，tag/source 对应 9ee74afaf8d8841ed8ddbcb258ae61b61ac9a1c9，上传四项资产摘要已核对。沿用 Pages 代发入口 https://znote-capture-inbox.pages.dev/downloads/ZNote-0.10.0-beta.22-android.apk ，latest.json 已升 beta.22，公网APK与原签名包以及源码ZIP逐字节摘要一致，证据 artifacts/cloudflare-release-live-sYFQ65/result.json。原3741与远程health正常，原前端资产不变，无需重启图库；未声称修复既有GitHub匿名目录/旧App检查更新访问问题。

## 手机仅优化采集浮窗（2026-10-21，四版交互模型待选）

- 最新用户决定暂不大改App，只优化展开/收起浮窗，要求修改原生实现前先给四版选择。此决定收窄上轮整套手机主题提案；未收到选型前不能改原生浮窗或发布外观更新。历史主题目录保留但已注明暂缓。
- 现有CaptureAssistService拖动只改窗口位置，收起形状仅依左右偏好绘制，拖离仍是半圆；结果使用字体字符。设计应明确区分贴边、拖离、展开与任务状态，恢复完整按钮而非拖着半圆到处走；线条图标替代字体/emoji风格，减少遮挡，记忆选库、粘贴、前往知识库、失败重试保持。
- 新独立提案 docs/design/overlay-ui/，同一深蓝色与手写Z：A磁吸豆（细豆/圆钮/小卡片）、B折页签（页签/圆角方钮/书签卡片）、C轻胶囊（小圆弧/圆钮/横向双操作）、D侧边轨（细线/圆角方钮/侧抽屉）。拖离即完整，松手就近吸边；采集收起，成功短提示回收并留标记，失败不强开面板且可重试。目标库变更不篡改上一任务结果的归属。
- 公开预览 https://znote-capture-inbox.pages.dev/design/overlay-ui/ 已通过受控轻量Pages构建发布。全部素材与任务均模拟，无剪贴板读取或采集/图库API调用；白名单只发布三静态文件。贴边视觉尺寸与触区区分，原生实施需验证机型边缘手势，不能把CSS像素说成已实测dp。
- tests/overlay-design-preview.mjs本机及实际公网鼠标/模拟触屏验收四方案，覆盖拖动中变形、左右吸边、取消不误开、短提示回收、失败重试、粘贴校验、选库、跳转示意、关闭、键盘、背景触屏滚动与320px窄屏。公网三文件与源码字节一致；证据 artifacts/overlay-design-preview-AU03CP/result.json，four-overlays.png已目视检查，窄屏截图亦检查。首轮发现窄屏grid最小宽度溢出并修正；触屏甩动后等待实际滚动停止再测外部按钮，避免将惯性停止触摸误判为按钮失效。
- 原3741和远程health均正常、原前端资产未变。本轮没有修改Android源码、构建APK或验证荣耀真机；不得把交互模型已部署说成用户手机问题已修复。选型后才落地并真机/原生验收。

## 手机 App 与采集浮窗四版外观提案（2026-10-21，待用户选择）

- 用户明确本轮只改手机 App 和采集浮窗，要求先提供几版选择。四版为 A纸白（浅白森林绿）、B石墨（深色暖金）、C雾蓝（圆润悬浮底栏）、D暖砂（纸感陶土色）；保留已选手写Z。尚未替换真实App、浮窗或网页图库，不应把提案演示说成原生功能已完成。
- 独立源码 docs/design/mobile-ui/，公开交互预览 https://znote-capture-inbox.pages.dev/design/mobile-ui/ 。仅原创SVG示意素材、模拟数据和模拟结果，无第三方依赖、不调用知识库或采集API；Pages构建只复制三个公开静态文件，不暴露配置或真实媒体。选定后再实施，并保留原采集能力。
- 预览覆盖首页/相册/设置、选库、粘贴、前往知识库、自动收起后的状态、失败恢复、半圆拖拽贴边。四版支持独立查看与总览；切换风格时展开面板供比较，外层比较标题CSS需限定直系header，避免污染深色手机内标题。
- 受控轻量Pages生产构建部署成功，真实公网三文件与源码字节一致；桌面与模拟触屏逐版检查交互、关闭、边界、失败恢复和320px窄屏，零API调用。证据 artifacts/mobile-style-preview-ZIFiwq/result.json，four-styles.png及touch-320.png已目视检查。原3741和远程health正常、原前端资产未变；未构建APK，未验证荣耀真机，不能声称手机App已改版。

## 手机邀请链接丢授权修复（2026-10-21）

- 用户实际打开邀请显示「邀请不完整」。此前授权在 #code fragment，connect.js 随后把唯一授权从地址栏清掉；刷新、复制清理后的地址或某些打开链路丢 fragment 都会失效。之前只验证首次打开和清空片段，没有覆盖刷新/重开，是验收遗漏，不能归因于用户操作。
- setup.mjs pair 改为完整 /connect/<一次性码>，Worker/Pages 直接支持这个路径，网页保留完整地址；旧 #code 链接首次打开会升级为新路径。裸 /connect 提供完整邀请粘贴恢复，拒绝跳到其他域名，不再叫手机用户到开发机重新生成。交付必须给完整邀请链接，不能只给裸域名。此变更没有更新 APK；beta.21 的原 znote://connect 导入协议保持兼容。
- 主按钮仍通过显式包名 Intent 导入。浏览器拦截时点「复制备用配置」，复制已发布 App 能解析的 znote:// 配置再粘贴；不要再让用户把新版 HTTPS 路径直接粘进只识别旧 HTTPS fragment 的 beta.21 解析器。复制失败有明确反馈可重试，网页采集是另一个备用入口。
- 码随完整邀请页请求送达自己的 Cloudflare，不再宣称它从所有 HTTP 请求隐藏；继续使用24小时单次码、no-store、no-referrer、无第三方脚本。GET预览、刷新和重新打开不兑换授权，只有用户操作才登录；不能用裸域名自动取最新私有码或绕开配对。
- 8项定向API回归通过；桌面和模拟触屏覆盖旧链接升级、新路径直接打开、刷新/新标签重开、预览不兑换、原生参数/复制失败恢复、错误域名粘贴拒绝、缺码恢复、浏览器授权与已用码提示。隔离证据 artifacts/cloudflare-import-ui-gkepeC/；实际公网证据 artifacts/cloudflare-import-ui-38pwMV/（截图已目视检查）。Pages/Worker受控生产构建已部署，原图库/后台收件/已签名APK保持原状；未操作荣耀真机，不能把上述检查说成手机真机已通过。

## 手机远程采集一键导入（2026-10-21）

- 用户认为分别填写服务器地址和连接码太复杂，要求一键导入。Android 0.10.0-beta.21 / versionCode 10021 支持连接邀请；setup.mjs pair 的私有 pairing.json 提供 import_url。手机打开邀请，点「导入 ZNote App → 确认连接」自动带入地址并兑换浮窗独立授权，不能再交付两个字段让用户抄写。旧版先在应用内覆盖更新一次。
- 历史实现（已被上文完整邀请修复替换）：HTTPS /connect#code=… 的密钥只在 fragment，页面立即移除地址栏片段，不发送到页面请求或第三方、不因链接预览自动兑换；Android 使用带固定包名的 Intent 唤起 znote://connect，App 显示目标地址再由用户确认。浏览器拦截唤起时，App 连接页可粘贴完整邀请；邀请24小时单次有效，不提交或公开真实邀请。
- ConnectionImport 复用原地址规范化，拒绝公网 HTTP、用户信息、重复参数及异常路径，不跟随跳转；健康接口必须为 remote-capture，登录后单独兑换设备 token。token 兑换失败保留本轮会话重试；成功存入原按 origin 隔离的 CaptureAuthorization/CookieManager，provider 可直接供浮窗使用。成功前不改原连接；原地址保留 previous_origin，清掉不适用于新服务器的上次选库。连续邀请只保留一个确认框，连接中不重复提交。
- GitHub Actions 本次返回 “Actions has been disabled for this user”，没有创建运行；不要反复触发失败构建。已有本机 JDK21 / SDK36 / Gradle8.13 缓存完整，scripts/build-android-controlled.ps1 -PrioritizeBuildWhenNoGame 可离线构建 release/Lint/debug/test APK，512MiB heap、单 worker、无持久 daemon。scripts/run-android-guarded.mjs 按真实 NRC-Win64-Shipping 与1.5GiB内存门槛持续监测、只清理自己进程树，无自动重启；Android 仍无游戏期间长期例外。发布继续沿用 LOCALAPPDATA/ZNote/signing 原 keystore/DPAPI，证书 SHA256 4e42f079d9ac5c4154a53eaa3ea6a82720ddc8be3ad3c9f84d0bea7abc62101b，版本序号必须高于10020。
- 实际独立 Android30 模拟器已验证隐式链接解析、触屏确认/取消、原配置保留、503后同会话重试、网页直接已登录、provider 持久授权、已用邀请拒绝与无效链接，证据 artifacts/android-import-local-g8swMZ/result.txt / connection-import.png（已目视检查）。旧 WebView 不支持 replaceChildren，远程任务页改用兼容 DOM 更新，同时不依赖 crypto.randomUUID。测试触屏必须设置 SOURCE_TOUCHSCREEN，不能把未送达的注入事件当产品按钮失效；截图写私有文件并由 run-as 取回，避免外部文件提取静默失败。只使用新建测试模拟器，不接触用户设备，结束清理所属进程。
- 实际 Pages 固定入口桌面/模拟触屏验证邀请、密钥不入请求、显式 Android Intent、浏览器备用登录、设备 token 与失效提示，授权用后撤销，证据 artifacts/cloudflare-import-ui-8zir5i/result.json；7项定向回归与原图组/选库/离线队列/重试UI回归通过（artifacts/cloudflare-inbox-ui-FxyXuA/）。Worker/Pages生产构建部署与原签名/versionCode核对通过。仍不能说荣耀真机已验证；此入口只远程采集，未改变平台解析兼容性或开放原图库。

- beta.21 已发布为 android-v0.10.0-beta.21，原 APK / source 对应提交 6e0a7fc53507d9234331bde125d2acdf0d461c31，APK SHA256 e1014ed68df8fbe5cb081055fbec060d59c87b50288d6b0644a96636581ce35d。GitHub 已登录 API 可见 public 仓库/Release，但匿名 releases API 与 APK 下载均实测404（含 UA 与 cache-bust 重试）；不能因此说仓库是 private，具体账号原因未确认，也不能直接让用户在 App 检查更新来代替验证。
- 此次由同一 Pages 主入口代发已签名 APK 和对应源码 ZIP（约193KB/5.5MB），邀请页自动展示同源下载。build-pages.mjs 只按被忽略的 client-release.json 白名单复制 artifacts 下两个公开产物，验证 SHA256 与24MiB文件预算；/downloads/* 静态路由不走鉴权，不暴露原图库或任何配置。公开下载实际摘要与已签名包/源码一致，证据 artifacts/cloudflare-release-live-xeGcgZ/result.json；带下载入口的实际桌面/触屏邀请复测及截图已检查，证据 artifacts/cloudflare-import-ui-L9TyCA/。旧 App 内仍使用原 GitHub 更新协议，本次需通过同源下载覆盖更新一次；不要声称修好了 GitHub 匿名访问或升级了旧 APK 的更新协议。

## 免费跨网络浮窗采集收件箱（2026-10-21）

- 用户没有域名、有 Cloudflare 账号，主要通过手机浮窗发送分享链接，不上传大视频；关注抖音、小红书、贴吧、B站、Pixiv、X、小黑盒等。跨网传输与平台解析是两件事，不能把任意站点/需登录作品说成已经兼容。小黑盒目前无专用解析器，手机拿到链接后由既有采集器处理，失败必须回传真实原因。
- 启动 cloudflared 直接把本机 3741 暴露到公网曾被自动审批拒绝，仅返回 blocked by policy，未启动隧道。改用独立 Cloudflare Worker / Pages＋D1 收件箱，开发机主动 HTTPS 拉取；不提供公网本机反向代理，不转发任意本地路径，不上传原图/视频或本机 API 凭据。App 远程首页是采集任务页，完整图库仍用原局域网入口，不能误称整个知识库已远程可浏览。
- 可选源码统一在 addons/connectors/cloudflare/，root README、addons/README、docs/README、CLIENTS 都有入口。worker.js 与 portal.js 提供 health、一次性码登录、设备令牌、目录、提交/进度/重试；对照现有 Android MainActivity / CaptureSessionProvider / ShareActivity / CaptureAssistService 接口实现，不需要重做 APK。24 小时有效的一次性码独立于原 PIN，浏览器会话 30 天、设备令牌 180 天；原 PIN 未修改。实际地址、D1/账号编号及凭据仅在 data/cloudflare-collector/，不得提交配置或把原本机 API key 作为云端密钥。
- 实际 Worker 与 Pages 固定地址已经发布并绑定同一私有 D1，当前主地址读取 config.json.relay_origin，别手抄历史预览部署 URL。仅使用 Free 可用能力，未开通付费订阅或 R2。客户端仅上传链接/正文、选库信息，D1 保存目录与状态；成功云记录保留七天，失败可重试，未完成/失败总量上限 200。十秒轮询，清理扫描每小时才执行；个人使用应核对 Workers 100k 请求/日、D1 5m 读/100k 写/日额度，不称无限免费。
- 本机 ZNote-Cloudflare-Collector 后台任务已安装运行，沿用无窗口 conhost / Windows Job Object、单实例锁与 128 MiB Node heap；实测收件进程工作集约 32 MiB。原 ZNote-Server / 3741 PID 102108 保持运行，前端原 index-DSR6IMg-.js 未变化。连接器状态/凭据与日志在 data/cloudflare-collector/；主动读本机受限接口，云输入不能指定本机路径、命令、令牌或其他 HTTP 目的地。
- 云端租约 120 秒，持久状态保留云任务/租约/本机任务；本机 request_id=cf:<云任务UUID>，提交响应丢失后仍去重。终态回传失败时保留 outbox；只有用户明确云端重试代次才触发本机失败任务重试，旧租约不能覆盖新状态。关闭再启动任务需等原 Node 真正退出；曾只等 500ms 导致锁正确拒绝重复启动，随后分钟触发恢复，不可因此删锁或杀不明 Node。jsonClient 正确接收清理接口的空 204。
- 7 项定向队列/配对/权限/租约/断线去重/重试与原手机长期授权测试通过；隔离实例桌面与模拟触屏端到端通过，证据 artifacts/cloudflare-inbox-ui-U0kqLo/。实际公网 HTTPS → D1 → 已运行本机 API → 原图落盘 → 云状态成功，网页会话和 Android 协议设备 token 分别保存一张 8090 字节公共测试 PNG，媒体接口/hash 核对、选库、触屏无横向溢出均验证；临时库、两条云记录、本机任务/媒体和临时授权已清理，证据 artifacts/cloudflare-inbox-live-v7Jjhu/result.json 及截图，已目视检查。另一次真实测试源站 404 正确回传 failed，没有伪报成功；一个在目录等待超时留下的测试会话已按 UUID/期限精确撤销，live 脚本 finally 已补充提前取 Cookie 清理。
- 已执行受控 Worker/Pages 构建部署及原前端生产构建，当前入口与 3741 健康、原前端哈希、测试库清理、独立本机写入凭据、空收件状态已复核，证据 artifacts/remote-access/final-verified.json。Windows 有效 Cloudflare OAuth 经系统代理刷新复用，没有要求用户粘贴 CF 密钥。Wrangler 4.151.3 新 Pages 创建命令会默认委托 Workers 并自动改根 package/lock/Vite：本次已恢复三文件为原 HEAD，迁走生成的根配置和重定向缓存、重新构建；没有迁移主 ZNote 到云。以后只在独立目录明确选 Pages，用部署包装器的标准 wrangler.json，不能让上级 wrangler.json 抢先于子目录 jsonc，也不能将 account_id 放 Pages 配置；账号经环境传入。
- 开发机实测 workers.dev、pages.dev 直连均超时（HTTP 000），经 Clash 代理的 HTTPS/API/UI 正常；不能把经代理通过说成国内手机可直连。已异步询问手机有无代理，手机真机网络及浮窗实操未代验；交付必须说明实际网络前提。最终一次性连接码通过 setup.mjs pair 写入私有 pairing.json，临近交付生成，不能从历史日志抄过期码。迁移连接器需单独安全迁移部署状态并核对本机令牌，不把云端收件箱当原图库备份。

## 扩展原生弹窗缩成细条（2026-10-21）

- 用户截图为浏览器工具栏的网页采集 action 弹窗；安装目录 popup.css 与源码相同。旧 `.popup{width:384px;max-width:100vw}` 在弹窗自动计算尺寸时循环受自身初始小视口约束，真实 Edge 原生弹窗复现 innerWidth/bodyWidth=66px，截图 artifacts/popup-native-60fh4b/native.png。普通固定视口标签页无法发现本例，不能再只打开 popup.html 新标签当原生尺寸验收。
- 0.9.40 去除弹窗主体的 vw 最大宽度，html 和 body 明确 384px 内容宽度及最小/最大宽度，保留原有纵向滚动、页面布局和连接设置。不同标签有无纵向滚动条会让外壳视口在 384/399px 切换，内容始终 384px；不把滚动条宽度变化误当内容又缩窄。
- 现在可以在无头 Edge 中让扩展 service worker 调用 chrome.action.openPopup，再通过 Target.getTargets 找到未被 Playwright context.pages() 暴露的原生 popup target；使用 Target.attachToTarget（flatten=false）和 Target.sendMessageToTarget 检查尺寸、发送真实鼠标/触屏/键盘输入、截图。关闭使用页面 window.close 后等 target 消失，不能仅 Target.closeTarget 留下原生弹窗外壳而导致下一次 openPopup 失败。测试方法见 tests/clipper-popup-layout-ui.mjs --live。
- 源码和本机安装目录 C:/Users/31093/Downloads/clipper 的独立 Edge 原生弹窗分别完成鼠标及模拟触屏验收：三标签、键盘 Home、帮助开启/关闭、展开链接、长失败文本、网络阻断后重连、关闭再打开，内容恒为 384px，主内容没有横向溢出。已目视检查截图，证据 artifacts/popup-layout-cA7x7v/result.json、popup-layout-riygZ0/result.json。测试临时写入授权仅供当前 3741 读取知识库列表，结束清理，没有创建媒体或改写用户连接设置/PIN。
- 6 项扩展打包/认证/保存方式相关回归通过；受控轻量扩展构建和前端生产构建通过，日志 artifacts/albums/popup-layout-regression.log、popup-layout-extension-build.log、popup-layout-build.log。首轮外层 PowerShell 对旧 LASTEXITCODE 的判断误报扩展构建失败，实际受控 Node 任务成功、两个输出日志为空；没有资源守卫中断，不把这个误报说成构建工具故障。
- 已只替换安装目录 popup.css 和版本号，扩展 ID key、授权及配置保留；当前 3741 下载包为 0.9.40，CSS 与源码/安装目录字节一致，证据 artifacts/popup-package-verified.json。纯扩展 CSS 修改，无需重启正在运行的知识库服务，health=ok，前端生产资产未变化。用户现有普通浏览器未被调试或强制重启，仍需在扩展管理点重新加载后再次打开；原生弹窗验收使用独立测试配置，模拟触屏不等于 Android 真机。

## 空图组误报成功与 X 原图补采（2026-10-17）

- 用户反馈最近显示“图文已保存”却没有图片。实际任务 9f76deef-0379-42c2-a5e1-30f3e402e11d（X status 2040040106850189633，目标建模学习）明确 image_mode=group，但只创建一条 note、零图片。captures.js 在 mediaCount=0 时降为笔记，并无条件提示“配图已保存到本地”；不是上一轮代理连接修复已覆盖的问题。原浏览器 DOM/提交计划已不保留，不能声称已直接看到当时页面媒体结构。
- 显式 group 取不到任何媒体必须失败、不写纯文字卡片，失败后重试刷新空计划；默认 X 图组也一样。其他网页和贴吧的默认纯文字笔记仍可保存，提示改为“文字笔记已入库（无配图）”，有图笔记显示实际配图数。旧显式 group 的 identity 文字笔记记录重新标为失败可重试；补采保留原文字笔记与用户修改，已删除/移动的原内容阻止重建，完成后不重复采集。压缩存储的旧笔记未自动扫描修复，不把不能读取的正文当成零图。
- 扩展 0.9.39 在现有按推文 ID 读取的 React/GraphQL 数据链路加入 photo 原图列表，页面图片 DOM 未挂载时仍可取得四张有序原图；引用帖分开编号，只传媒体 URL、不传 Cookie 或完整响应。没有读到媒体明确失败，不能用文字假成功。敏感媒体未显示、正文未展开和视频无播放地址仍保留失败提示。没有证明用户当时究竟属于哪种 DOM 状态。
- 实际原帖公开嵌入接口仍返回空；本次恢复从 FxTwitter 公开镜像仅取得该帖元数据与四条 pbs.twimg.com 原图地址，核对推文 ID/来源后通过原 request_id 补采同一任务。没有引入生产环境的自动第三方兜底。四张已保存到原知识库同一组，序号 0–3，源站原图、数据库 hash 和当前 original 接口字节全一致；原 note dacaedce-b759-485d-aac3-b120f162c6cd 全字段保留。证据 artifacts/capture-audit/recovery.json、api-verified.json。
- 31 项采集/失败继续/空图组/旧任务恢复/范围保护/X媒体测试通过，另 4 项保存策略测试已过；轻量前端生产构建和扩展构建通过。无在途任务后重启当前 3741 到 PID 102108、0.0.0.0，health=ok；前端资产仍 index-DSR6IMg-.js / index-Be0_EwDp.css。当前实例实际空图组请求为 failed 且零新资源，验收任务/令牌已清理，PIN 未改。
- 当前实际图片组的桌面和模拟触屏验证全部四张解码、缩略图跳转、最后一张边界和关闭，证据 artifacts/image-network-live-SDs17H/result.json；图片遮蔽截图已目视检查。安装目录 C:/Users/31093/Downloads/clipper 的三个 X 脚本和 0.9.39 版本已更新；服务端下载 ZIP 三个脚本字节相同。安装目录扩展在独立 Edge 桌面/模拟触屏覆盖空媒体失败、React 四图恢复、引用排除、正文展开、去重、关闭，证据 artifacts/x-browser-ui-JSGHbF/result.json。用户正在运行的普通浏览器未开启调试，未强行关闭；仍须重新加载扩展并刷新原帖。没有直接验证 Android 真机或用户当时 X 页面的真实 DOM。

## 图片采集代理切换与连接恢复（2026-10-17，已部署与真实失败任务验收）

- 用户报 4 张图片 ETIMEDOUT / ECONNREFUSED 199.59.148.9:443 / 下载超时，定位到原任务 d19faa9c-73f9-46a7-a8a2-4010bc214864。当前系统代理 127.0.0.1:7897 正常，独立新进程获取同一原图只需约 1.1 秒；旧服务原任务仍重复四张全超时。network-proxy.js 把启动时的代理（包括关闭状态）永久缓存，后台不会跟随后续系统代理变化。不能把浏览器能上网等同于长驻服务已使用新代理。
- 系统代理改为 5 秒有效缓存；显式环境配置每次读取且优先，失败重试立即清缓存。WinINet 分协议配置明确优先 HTTPS，不再被排列在前面的 HTTP 项抢占。未修改用户 Clash、系统代理或其他应用配置，不硬编码常见端口作为全局兜底。
- 原图下载对连接超时、拒绝/重置、临时 DNS/路由错误、传输中断及 502/503/504 至多自动补试一次，补试前重读代理；持续失败照实上报。15 秒请求计时覆盖响应体，不在请求 close 时提前撤掉保护；失败销毁本次请求/响应，避免半截文件或卡住后续。404、验证页、大小限制、429、EH 站点冷却与私网拦截不自动重试，不放松 DNS/重定向/TLS 安全限制。
- 35 项采集、EH 警告/冷却、图片备用与网络回归通过；新增一个真实本地 HTTP CONNECT 代理的长驻下载器缓存直连→系统启用代理→补试切换集成测试通过，共 36 项不同测试。生产构建 384 MiB / GOMAXPROCS=1 通过，2.47 秒；无在途任务时重启 3741 到 PID 14864、0.0.0.0，health=ok。后端改动，前端资产仍是 index-DSR6IMg-.js / index-Be0_EwDp.css，无需重打 APK 或扩展。日志 artifacts/albums/image-network-tests.log、image-network-proxy-integration.log、image-network-build.log。
- 只重试用户原有失败记录，未创建新采集任务：原四张组完成，另两个同类 X 失败任务也完成（2 张与 4 张），共 10 张保留原来源、备注与组内顺序。每张当前 original 接口字节/hash 与数据库一致，原四张组首张还与独立下载原图 hash 一致；已完成任务再次 retry 返回 409，不重复建卡。PIN 未变，临时认证清理。
- 当前实际实例在桌面与模拟触屏逐一检查全部 10 张加载、缩略图跳转、末页边界、关闭，无脚本错误；截图遮蔽个人媒体且已目视检查。证据 artifacts/image-network-live-rjeIri/result.json；tests/image-network-live.mjs --live 可显式复核既有任务，不能拿模拟测试替代本例实际入库。未直接验证 Android 真机，未通过修改真实系统代理来演示热切换；热切换由本地代理实连测试验证。

## 图组误触正文配图限制（2026-10-13，已部署与真实图集验收）

- 用户 jliji.com/set/2281 实际有 101 张图。当前真实采集记录 264f86c6-d156-4364-a573-8b8f2c329907 的 input.image_mode 已为 group，却报“单次正文配图最多 100 张”：通用 Readability 只把配图放入 Markdown，plan.images 为空；captures.js 仅按 plan.images 判定组，mediaCount=0 导致 album=false，误用正文限制，组键也为空。修正统计同时计入正文图片和独立图列，并按 URL 去重；明确 group 不再丢失组模式。
- 图组通用执行上限从 200 调整为 10000，与现有媒体组管理边界一致；仍逐张下载、逐张保存，不把整组原件同时放内存。笔记正文限制仍为 100，网站解析器各自的独立页数边界没有全局删除；不宣称所有平台任意数量均支持。
- 新增 capture-gallery.js 识别 jliji 的 /set/数字，只读当前作品 gallery-grid 内匹配 data-set-id 的图，使用 data-full 原图；旧解析取得 src 的 thumbs 缩略图。检查重复/缺失地址和页面声明总数，不包含推荐/广告，不用缩略图掩盖缺图。默认图组，标题/分类元数据进备注。未保存任何媒体的旧失败任务重试会重读新解析；已有任何已保存页（即使第一页失败）仍保留原计划，防止换序覆盖稳定 ID。
- 初始检测到洛克王国 NRC-Win64-Shipping（PID 87628）时仅做轻量源码和 11 项小型测试。用户随后明确“允许你构建和修复”，本次串行构建/验收采用任务专用资源守卫，持续检查内存、仅停止本任务子进程，不改通用游戏守卫，不将本次授权扩展到后续任务。相关采集回归共 38 项通过；生产构建 GOMAXPROCS=1、384 MiB heap，通过。日志 artifacts/albums/gallery-regression.log、gallery-build.log。
- 无在途任务时重启实际 ZNote 服务，3741 监听 0.0.0.0，PID 100436，2026-10-13 05:24:53 启动；当前 resolve 接口返回 jliji-gallery-v1、101 张原图。仅重试用户原失败任务 264f86c6-d156-4364-a573-8b8f2c329907，没有另建重复任务；实际 completed，用户原目标知识库中一个图片组、101 个成员、顺序 0–100、正文与来源备注完整，总原件 19276300 字节。首/中/末原图的 SHA-256 与本地文件及当前 media/original 接口字节一致；全部 101 张为原图尺寸。
- 当前实例桌面与模拟触屏 UI 验证第 1/51/101 张缩略图跳转、图片实际解码、上一张/下一张及首末边界、关闭，无页面脚本错误或横向溢出；截图已目视检查并遮蔽个人媒体。证据 artifacts/gallery-capture-live-ivzbvQ/result.json、gallery-capture-live-wudMdy/result.json。追加检查首次因可用内存不足 1.5 GiB 未启动；重新核对资源后串行执行，两端检查和清理均完成，守卫在收尾时又报告内存阈值，不再启动其他重任务。临时认证已清理，PIN 未变，用户入库结果保留。未直接验证 Android 真机；服务端改动无需重打 APK，旧网页需要刷新。tests/gallery-capture-live.mjs --live 明确只对这个既有任务做验收，失败时重试而不创建重复采集。

## 恢复快照容量限制（2026-10-12，已部署）

- 用户要求停止占空间的全量复制。默认保留数降为 1，额外文件占用上限 max_extra_mb=1024（MiB，即 1 GiB）。当前实例 policy.json 与 API 均为 enabled=true、24 小时、keep=1；不得以后自行恢复七份。只在新快照成功后轮换，失败不会先删除唯一恢复点。正在预览的历史点和恢复前安全快照是明确的保留例外。
- 新快照必须硬链接共享媒体，探测失败或中途失败均清理本次暂存、保留旧快照，不再 fallback 整库复制。显式恢复迁移包仍保留跨盘复制能力，不能混同两条路径。容量检查包含旧快照与本次新快照临时并存的额外占用，创建前估算、发布前重新核对，并预留 256 MiB 磁盘空间。507 返回明确原因，其他未标记安全的 5xx 仍隐藏内部错误。
- server/backup-space.js 按 dev/ino 去重，区分数据库等独立文件、当前共享媒体、仅快照保留媒体与历史独立副本；恢复会改文件键，必须按所有 live 文件物理身份匹配，不能只比较同名路径。统计是文件字节数，不含文件系统目录开销；后台查询缓存一分钟，可手动重新核对。图库清理后历史媒体可能使占用超限，暂停新建而不自动抹掉最后恢复点；同盘快照不能防磁盘损坏。迁移 ZIP 仍按需流式生成，不长期存整包。
- 验收：18 项容量/硬链接/磁盘故障、回滚、保留/恢复与原子发布测试通过；7 项视频、BGM、收藏相册备份恢复回归通过。生产构建通过，当前 3741 已重启加载新脚本。实际创建 1791776520125-ac63d520-f919-43f2-a157-c2a8750b0a19.snapshot，轮换后仅 1 份；13613 个媒体逐文件物理身份与 live 一致，copied_files=0；可恢复 27857587816 字节，额外文件占用 57553374 字节（约 54.89 MiB），历史保留/独立媒体为 0，PIN 未变。
- 当前实例桌面与模拟触屏 UI 覆盖容量边界、保存失败后重试、帮助触屏固定/键盘关闭、重新核对与关闭设置，截图已目视检查；证据 artifacts/backup-space-ui-RDAMyn/result.json 与截图，日志 artifacts/albums/backup-limits-final.log、backup-media-regression.log、backup-budget-build.log。未对用户真实库执行恢复覆盖，也未验证手机真机；恢复往返在独立实例测试。不把目录逻辑大小相加当作新增占用。重载旧页面后查看新设置。

## 扩展预览遮挡与备份占用核查（2026-10-12）

- 用户随后明确反对保留七个历史点；当前实例通过 /api/backups/policy 将 keep 降为 1，间隔 24 小时和自动启用状态不变，API 与 policy.json 均已核对。当前恰好只有一份，未删除额外快照或新建备份。后续方案不得自行恢复七份保留，自动复制整库的兜底与容量预算仍待实现；证据 artifacts/preview-layer/retention-one.json。
- 用户明确是浏览器扩展预览被网站元素挡住，不是 ZNote 本体预览。普通 DOM 的最大 z-index 仍会被后插入的同级元素或原生 top layer 遮挡；已用真实 Edge 加载扩展复现，基线截图 artifacts/preview-layer-ui-vx9sG6/baseline-covered.png 已目视检查。
- 网页采集 0.9.38 新增 overlay-layer.js，媒体预览宿主使用 manual popover 非模态顶层，避免锁住页面滚动/焦点。网站 modal 中须将宿主放入该 modal 再升层，否则预览虽可见但按钮 inert；不关闭或修改网站弹窗。捕获网站 toggle/fullscreenchange，仅预览可见时重新升层；直接观察宿主祖先的 childList，处理网站删掉弹窗连带移除扩展宿主，不全页面 subtree 观察。Esc 从预览按钮或输入框都只关闭扩展预览；iframe 内的预览仍受 frame 边界限制，不宣称跨 frame 顶层。
- 10 项相关接口/打包/保存方式/缓存回归、扩展生产构建通过；鼠标悬停缩略图和预览中滚轮翻页、慢图连续输入、原图下载字节与预览外正常滚动验收通过。已更新 C:/Users/31093/Downloads/clipper 的四个相关文件，保持固定 ID/连接设置；该安装目录在独立 Edge 桌面和模拟触屏上下文覆盖后插入网页元素、原生 popover/modal、全屏、网站移除 modal 后恢复、翻页、输入框 Esc、网页点击/滚动，证据 artifacts/preview-layer-ui-x3ayiU/result.json，截图已目视检查。当前 3741 /api/clipper/download 返回 0.9.38，ZIP 的新 helper 与 overlay 字节和源码相同，PIN 未变；用户现有浏览器不是调试实例，未强行重启/关闭，要在扩展管理点重新加载并刷新原网页。未收到具体出问题的网站 URL，不能称其真实网页已逐一验证。
- 用户已删两份备份，不能再核对它们当时是否额外复制。当前自动快照策略仍 enabled=true、24 小时、keep=7，今早生成 1791762433953-cff73479-9651-49e9-848a-a0cb0442fad8.snapshot。当前接口与磁盘逐文件 dev/ino/nlink 核对：可恢复 27851583245 字节、生成时新增 57553154 字节，13608 个媒体文件全部与 live media 共享、零复制、无仅快照保留的媒体；不能把目录逻辑大小相加当实际额外占用。证据 artifacts/preview-layer/backup-evidence.json、current-api.json。
- 新备份方案是建议，尚未改策略或实现：本机恢复继续用小型 SQLite 一致性快照＋不可变媒体引用，限制保留版本/占用预算；硬链接失败不能默默回退复制整个素材库，界面分别呈现可恢复量、本次新增量、已删但快照保留量。同盘恢复不能防硬盘损坏；可选异盘/NAS的独立增量去重库（例如 restic），首份保存原件、随后只写变化内容，并按版本清理无引用数据。迁移 ZIP 仍按需流式导出、服务器不长期存整包；迁移/恢复的大库大小边界与一致性须另行验收。任何大规模备份扫描/校验/压缩也遵守游戏与内存限制。

## 自定义收藏相册（2026-10-11，已部署与桌面/模拟触屏验收）

- 用户要求：可持续增删改的自定义相册分区，入口与收藏放一起；搜索/排序/视图工具栏与更新提示不要挤在一起。相册属于当前知识库（含未分类）；同一资源可关联多个相册，不复制原文件，不改正文、来源或分组。删除相册只删除分类；移动到其他库后不跨库显示，移回恢复；回收站隐藏，恢复重新显示，永久删除清理关联。
- schema 15 增量添加 albums、album_items 和索引。名称 1–80 字，不设相册数量上限；同库重名 409、重命名/删除检查 version，未分类有唯一索引。默认 favorite 独立、旧 API 保留。卡片、媒体/笔记预览、多选共用收藏菜单；整组按 kind+group_key+collection 展开，不拆组。仅单独变更默认收藏时保留撤销；相册分类/成员变动暂不进入撤销中心，可通过菜单反向操作恢复。
- /api/favorite-targets/preview 返回当前成员/version/分组快照/选中数量；提交原子应用明确勾选或取消的目标，未操作的混合选中保持原样。内容或组变动、跨库目标拒绝并允许重新读取。/api/items?album= 继承分页、排序、类型分区、标签、组折叠和图库范围；常用筛选保存 album_id，删除相册清理筛选关联。完整备份/恢复包含两张表，旧 schema 14 及更早备份兼容；元数据导出带相册及关联。
- 初始游戏运行时仅作轻量编辑/语法解析/小型接口测试，没有构建或浏览器；确认游戏退出、可用内存 5–7 GB 后才串行验收。scripts/run-resource-guarded.ps1 持续检查游戏/可用内存，停止自己启动的任务树且不自动重启。255 项已跟踪测试串行回归通过；随后批量收藏响应补充所有成员的最新摘要/version/album_ids，并合并选择缓存，6 项相册接口回归及真实页面连续批量标签验收通过。生产构建 GOMAXPROCS=1、384 MB old-space，约 2 秒。
- 当前 3741 PID 360468、schema 15、0.0.0.0，实际加载 index-DM69VDHY.js / index-BN2mdJS6.css。桌面/模拟触屏覆盖创建、重命名、删除当前相册后回到默认收藏、多相册整组收藏、笔记与组混合批量收藏及随后打标签、缩略图跳转、取消/关闭、帮助触屏保持、503 失败后重试和更新通知；工具栏/通知间距 18px / 16px，无横向溢出。浅色首轮、深色最终截图已目视检查；临时库/资源/令牌清理，PIN 未变，Android 真机未直接验证。证据 artifacts/albums-live-Dn2OJN/result.json、artifacts/albums/full-regression-final.log、artifacts/albums/albums-final-response.log、artifacts/albums/build-final.log；tests/albums-ui.mjs --live 是显式当前实例验收。
- 迁移前完整 schema 14 快照 data/backups/1791674451024-c9efbe5b-55aa-4614-9ea0-cfa2f92eb3a5.snapshot 仍保留，数据库 quick_check/外键检查通过，13576 个媒体文件（含配乐）存在并与 manifest 一致，PIN 相同。首次完整备份出现 Windows 原子 rename 的临时 EPERM；参考 graceful-fs 的重试策略新增 server/atomic-files.js，只对 Windows EPERM/EACCES/EBUSY 有界重试，不删除覆盖已有快照，不旁路永久拒绝；3 项故障测试与备份恢复集成测试通过。当前实例完整备份接口实际成功保存 schema 15 快照 1791675596311-8c2819d2-a2ba-4fd6-ade5-39174f0cdfac.snapshot，原 keep=2 策略未改、last_error=null，证据 artifacts/albums/actual-backup.log。OpenAPI 的 Item 是 allOf 组合，新增字段必须追加 allOf，不能假设顶层 properties 存在；已修复启动异常并确认服务健康。本项只迁移元数据，没有替换用户原文件。

## 百度贴吧图片组采集（2026-10-11，已部署与桌面/模拟触屏验收）

- 用户要求贴吧帖子仍按“图片组＋备注”保存。默认范围是楼主首帖与楼主追加楼层，不混入其他回复、楼中楼、头像、表情图片或推荐内容；正文、作者、吧名和原帖地址进入备注。单图保持单图、无图保存文字笔记，明确选择 note 时保留图文笔记模式。
- `server/capture-tieba.js` 接入已有 fetchCapturePage；手机分享和扩展“采集当前作品”复用服务端计划，不需要为本项新造浮窗或修改 APK。分享参数、pn 与 see_lz 不改变采集范围，规范地址是 `/p/帖子ID`；客户端只调用公开只读帖子接口，lz=1，并再次核对楼主 ID。
- 真实帖子 11090769629 的网页返回 403 百度安全验证，客户端 `/c/f/pb/page` 返回 HTTP 200 与完整楼主数据：1 楼、11 楼共 4 个图片引用，去重后 3 张。保留 origin_src 的完整签名，HTTPS 原图 GET 均为 200 image/jpeg（312179、398266、359591 字节）。接口 Content-Type 实际为 application/x-javascript，只在这个 JSON 请求分支接受；禁止 eval 或执行响应。参考上游 fuxiaoji/tieba_spider 的只读客户端协议，自行实现有界解析，没有复制整套爬虫。
- 最多串行 20 页、200 张去重图片、8 MB 数据；核对帖子、作者、分页和首楼，不完整/重复/变化分页或视频帖明确失败，不把验证页/视频封面当成功。原图地址失效可尝试平台提供的显示地址；下载单项失败继续后续，重试跳过已经成功的组成员。
- 10 项轻量解析/模拟保存测试通过（node --max-old-space-size=64 --test --test-concurrency=1，两文件，总约 1.5 秒）；真实链接通过生产源码 fetchCapturePage 只解析核对，进程 RSS 约 106 MiB，证据 artifacts/tieba/source-result.json。模拟数据库不是当前实例验收。
- 首次推进时游戏正在运行，因此没有构建或重启；用户随后明确允许“准许该次绕过限制执行构建和验收”。这只豁免本次贴吧构建与验收，不能改变长期禁高内存规则。按串行、单 worker、V8 内存上限运行：44 项相关回归通过；生产 Vite 构建通过（GOMAXPROCS=1，384 MB old-space，约 2.4 秒），没有 Android/Gradle 构建或模拟器。
- 实际 3741 服务已重启到 PID 325528、监听 0.0.0.0，前端资产 index-BUwSLRn8.js；真实接口只解析不写入，完整分享链接按一个图片组保存 3 张不同图片、1 张卡片，3 张原图与远端字节一致。正文、楼主追加内容、作者、吧名、出处均在每个成员备注；同 request_id 重放不重复。代码无需更换 APK 或扩展版本。
- 已安装 C:/Users/31093/Downloads/clipper 的 0.9.37 扩展在真实贴吧原帖网址（网页仍显示百度验证）通过“采集当前作品”成功保存，页面显示成功反馈。桌面和模拟触屏验收了缩略图数量/跳转、首尾边界、缩放/翻页、关闭、帮助、备注滚动阅读、503 图片加载失败后的重试；截图已目视检查。证据 artifacts/tieba-live-HWsOG3/result.json、artifacts/tieba/regression.log、artifacts/tieba/build.log。测试脚本 tests/tieba-capture-ui.mjs --live 为显式实际实例测试，ZNOTE_CLIPPER_DIR 可选指定安装目录。
- 最终临时库、图片、任务和临时 session/API 令牌已按自己的 ID 清理，PIN 未改变，浏览器构建/验收进程已释放。Android 真机与用户现有浏览器标签页未直接操作；手机分享与网页扩展复用已验证的服务端接口，不能将模拟触屏说成 Android 真机验收。

## 本机游戏与资源限制（2026-10-11，ZNote 轻量任务例外于 2026-10-13 更新）

- NRC-Win64-Shipping 存在即视为洛克王国运行，同时核对其他标题包含“洛克王国”的进程。高内存工作前必须可靠核对游戏状态与可用内存；游戏运行或状态不明时禁止本机 Gradle、编译、打包、Lint、大规模测试、模拟器、内存密集容器等工作，只推进轻量任务。
- 高内存任务运行中持续监测；游戏启动时只停止自己创建且归属可确认的任务和子进程，不得杀游戏、用户 IDE、其他项目或无归属 Java，不得全局 taskkill java.exe。不得自动重启被中断任务，重试重新检查。
- 非游戏期间高内存任务也采用单任务、单 worker、串行、不保留 Gradle/Kotlin daemon；结束释放自己的构建进程。限制下报告未验证范围及原因，不声称测试通过，不反复要求用户关闭游戏，不将泛泛“继续”理解为豁免。
- 2026-10-13 用户明确长期授权：“由于本项目构建基本不会占用太多内存，所以准许每次我在运行游戏的时候都放行。”ZNote 的轻量前端/浏览器扩展构建、相关小范围测试及单浏览器/单上下文验收无需每次确认；该例外优先于以上通用禁构建规则。全局 D:/CodexData/codex-home/AGENTS.md 与本仓库 AGENTS.md 均已记录，避免换会话后遗忘。其他项目和 Android/Gradle、桌面安装包、大规模测试、模拟器/容器继续受原规则限制。
- scripts/run-resource-guarded.ps1 的 -Lightweight 明确识别此次长期许可：必须提供 1–384 MiB V8 heap，GOMAXPROCS=1，仍核对游戏与可用内存；游戏存在本身不阻断轻量任务，空闲内存低于 1536 MiB 则只停止自己创建的任务树，不自动重启。默认不带该参数仍遵守游戏禁高内存。避免任务已在资源查询期间成功退出，却将随后内存阈值误报为任务失败；完成时以实际退出状态为准。

## 配乐进度条两端拖动（2026-10-13，已部署与桌面/模拟触屏验收）

- 用户反馈进度条前后各有一小段拖不到。当前真实配乐基线：原生 range 继承普通输入框的 padding:11px 12px，造成轨道两侧空白；step=0.1 使实际 duration=102.217125 秒的 End 和鼠标拖到右端只能得到 102.2 秒。不能把取值限制误认为原音频缺失。
- bgm.css 单独重置配乐 range 的 padding/border/margin，保留 32px 操作高度、原生鼠标/触屏/键盘与 focus 样式，配乐音量一并清除普通输入框内边距。进度 step 改 any，允许精确 duration；onChange 立即更新界面与 currentTime，拖动时不让后台 timeupdate 覆盖指针值，松手/取消/失焦恢复更新；同时监听 durationchange、seeking、seeked，避免暂停时进度显示延迟。
- 8 项配乐回归与 384 MiB / GOMAXPROCS=1 的生产构建通过；无在途任务时重启 3741 到 PID 88244、0.0.0.0，health=ok，实际页面加载 index-DSR6IMg-.js / index-Be0_EwDp.css。源码与运行资产均已核对。日志 artifacts/albums/bgm-seek-regression.log、bgm-seek-build.log。
- tests/bgm-seek-ui.mjs --live 在真实已有配乐上验证键盘 Home/End、鼠标连续拖拽、模拟触屏原生点选与 CDP touchStart/touchMove/touchEnd 连续拖拽：两端严格到 0 与 102.217125 秒，滑块值等于实际时间。播放过程中拖到中段仍继续播放，松手后进度继续增长，关闭停止。证据 artifacts/bgm-seek-live-5uxwh3/result.json（最终）与 JtN8oD/result.json（端点）；截图已目视检查并遮蔽个人媒体。PIN 与原有配乐不变，临时 session 清理。
- 已再验收上一条自动播放功能的桌面/模拟触屏打开播放、同组连续、暂停保持、关闭、pagehide、音频 503 后恢复；证据 artifacts/bgm-autoplay-live-Vmhr1a/result.json。Android 真机未直接验证，刷新网页即可加载，无需重打 APK。

## 图片组配乐自动播放（2026-10-13，已部署与桌面/模拟触屏验收）

- 用户要求点开图片组时自动播放已有配乐。useBgmPlayback 仍由 Workspace 持有，同一知识库/组/hash 的 audio 与 URL 不变；只有打开或更换有配乐的图片组时尝试播放。同组翻页继续，手动暂停不因翻页恢复；关闭、换组、pagehide、认证失效停止。单图、视频和笔记保留手动播放方式。
- play() 拒绝必须处理：自动播放被 NotAllowedError 拦截时明确提示点击播放；关闭/换组后的迟到拒绝和 AbortError 不污染下一首状态。网络/媒体失败保留重试入口，失败的音频再次播放先 reload。说明沿用 HelpHint，不能把播放失败冒充音频入库失败。
- 用户追加长期轻量构建许可后，4 项播放失败/恢复/迟到结果与 4 项配乐解析、采集、备份回归共 8 项通过；生产 Vite 构建以 384 MiB heap / GOMAXPROCS=1 串行执行，2.39 秒完成。确认在途任务为 0 后重启 3741（PID 101228，0.0.0.0），当前页面实际加载 index-BJolZ3R-.js / index-6ffndSPN.css，health 为 ok。日志 artifacts/albums/bgm-autoplay-regression.log、bgm-autoplay-build.log、bgm-autoplay-ui-final.log。
- tests/bgm-autoplay-ui.mjs --live 已在真实实例现有 7 张图的配乐组验收：桌面和模拟触屏卡片打开后真正播放且进度增长、同组翻页共用同一 audio / URL 且进度连续、手动暂停保持、关闭和 pagehide 停止、音频 503 后点击恢复。只创建并清理临时 session，PIN 与成员 title/bgm 未变，不上传/替换/删除配乐。证据 artifacts/bgm-autoplay-live-rpN3Ux/result.json 与截图，截图已目视检查。
- 首轮测试错误假设静音的 headless Edge 必定拦截未交互直达播放，实际上播放已成功；改为只注入一次 NotAllowedError 来明确验收阻止提示与手动恢复，其余播放与 503 恢复均使用真实浏览器与已有音频。这是失败路径注入，不能说成所有真实浏览器策略均已验证。Android MainActivity 的 WebView 当前 mediaPlaybackRequiresUserGesture=true，未直接验证 Android 真机，也未全局放开视频自动播放权限。页面更新刷新即可，无需为本次前端改动重打 APK。

## 作品配乐（2026-10-11）

- 抖音、小红书采集解析仅提取当前作品的 music / musicInfo / music_info 等明确音频播放字段，不采集推荐作品配乐、封面，也不把任意视频原声冒充独立 BGM。公开页面未返回独立地址时不能承诺采集配乐；之前两条小红书样例未提供地址。成熟实现参考 yt-dlp 的 TikTok/Douyin 音频分支，实际抖音 React Flight 数据已验证。
- schema 14 在 items 增加 bgm JSON 附件，音频按 SHA-256 保存、组内与跨作品相同音频复用，不增加卡片或改变分组。大小 50 MB，MP3/M4A/AAC/OGG/WAV/WebM；验证音频轨道、时长、原文件 hash，不接收 HTML、空文件或视频轨道。音频流沿用公共地址与跳转验证、流式大小限制，并限制采集音频总等待时间。
- 配乐失败时主要媒体仍为 completed，bgm_status / bgm_error 明确保留；重试只保存配乐、不重下或重复创建图片和视频，未成功的配乐计划不自动清除。已移动、删除、改组或设置其他配乐的内容不得被迟到采集覆盖。
- 实际音频元素放在 Workspace，不能放进随 selected.id 重新挂载的 Detail。缓存组身份和 hash 对应的首个音频 URL，同组翻页不重新加载；直达资源链接时，初始加载必须通过元素 src 正确设置，不能只依赖尚未挂载时的 effect。预览手动播放、循环、进度和音量，关闭或认证失效停播；播放配乐时视频暂时静音，暂停后恢复原来的静音状态。局部播放进度更新不使整个图库每帧重渲染。关闭后迟到的上传响应不能重新打开预览。
- 图片、视频、笔记附件复制、移动、回收站清理、存储统计、恢复快照和迁移 ZIP 都携带配乐；删除最后引用才回收原音频。快照与导出按文件去重，恢复验证原字节/hash并重映射配乐文件键；旧 schema 3–13 的备份仍可恢复。配乐上传/删除要求 write 和当前 version，组成员变化返回 409。普通字节去重只复用原文件，不把上一作品的配乐带入新作品，只有明确的素材复用才带走配乐。
- 当前 3741 实例用用户给的“整点兔兔”真实分享链接采集成功：2 个实况视频、1 张静态图片、3 个配乐附件引用同一首《糯叽叽》（Mew，79.73 秒）。证据 artifacts/bgm-capture-live-ubKhTj/result.json；临时验收知识库、任务、文件已按自身 ID 清理。已有该作品组也已补入这份配乐。
- 实际已有 5 张小红书图片组、2 个视频的抖音组，在桌面与模拟触屏验证同一个 audio 元素跨页继续、音量/进度、视频静音恢复、关闭停止、帮助键盘/点击和音频请求失败后的重试。界面截图已检查，证据 artifacts/bgm-live-KXKdc0/result.json；卡片数与 PIN 未改变；临时图片组配乐已移除，验收导致的卡片排序时间也按部署前快照恢复。手动上传/替换、无效音频后的恢复、草稿未保存禁用修改、上传期间关闭不会重开、整组移除均覆盖桌面与触屏；配乐文件名复用现有 UTF-8 multipart 解码，不能显示中文乱码。全量 237 项测试与生产构建通过，最终服务 PID 220620、schema 14。Android 真机未直接验证，手机分享与扩展入库复用服务器采集链路，网页预览加载服务器新构建，无需为本项更换 APK。旧页面需要刷新。

## 整帖图组与文件策略（2026-10-07）

- 浏览器截图同时保留可见页面和手动框选两种入口；框选支持桌面、触屏、重新拖动、取消与失败提示。移除遮罩后等待浏览器绘制再截图，按截图原生像素与视口比例裁剪；不得把遮罩或按钮截进入库结果。
- X 和小红书图片帖默认保存为图片组，正文进入每张图片的备注，保留出处、作者与标签；单图不创建只有一个成员的组。明确选择正文归档时仍允许图文笔记，B 站图文默认行为不变。
- X 整帖从自身嵌入接口读取完整 `mediaDetails` 原图顺序，仅提取当前推文，不抓头像、引用推文或视频封面。网页扩展增加单帖操作栏入口，也支持粘贴链接；普通扩展的小红书弹窗入口复用已登录页面数据。
- 大图片策略归服务器 `capture_settings_v1` 管理：`/api/capture-settings` 读取，管理员修改；ZNote 设置「采集与文件」选择原图或低损压缩。默认原图 ≤100 MB；自动压缩静态图片到 ≤25 MB，不改变尺寸。自动压缩不适用时保留原文件并写备注，PSD 保留图层 ≤200 MB。
- 扩展默认继承服务器策略，显式本地策略优先。私人插件旧 `ask` 值迁移为继承服务器，不能继续要求每张大图点击选项。私人源码仍只在本地忽略目录维护。
- 采集单张失败不得堵塞后续图片，任务保留失败原因；重试跳过已经成功的成员，不重复入库、不悄悄改变分组。
- 组内缩略图展开不能在点击过程中位移：网格使用 `auto-fit` 居中实际成员，触屏不响应模拟鼠标悬停或焦点自动展开，通过「展开全部」展开。

## 交付纪律

- 2026-10-10 登录恢复：PIN 不得因修复或验收被重置。网页原先只在挂载时检查登录，七天会话失效后会留下图库并报“请先登录”，却没有 PIN 输入机会。API/XHR 上传的 401 统一触发重新登录；登录接口输错密码、403 权限不足、登录探测与重新登录之前发出的迟到响应不触发这条恢复。回到前台也检查会话。重新登录期间图库保持挂载但隐藏/inert，保留未提交的笔记；隐藏窗口不能响应 Esc/手机返回，原生排序弹窗和帮助提示应收起，避免遮挡登录。有效浏览器 Cookie 至多每日续期至七天，受创建日起三十天上限约束；失效或撤销的会话不能续期，Bearer/API/手机持久授权不续期或失效。localhost、127.0.0.1 和局域网地址使用同一 PIN，但浏览器 Cookie 按主机隔离，不能误称跨主机已共享会话。
- 本次真实 3741 实例验证 localhost 桌面和 127.0.0.1 模拟触屏：首次 PIN、有效会话续期、过期 401 恢复、错误 PIN 提示、未提交正文保留、Esc 不关闭隐藏编辑器、排序弹窗不阻塞 PIN。正确 PIN 登录与编辑恢复在独立临时实例用已知测试 PIN 验证，未读取或改写用户 PIN；运行前后认证存储一致。证据 `artifacts/auth-ui-QrzhpW/result.json`。生产构建与认证测试通过；全量 230 项中备份历史测试遇到一次 Windows EPERM rename，单独复测通过，新增浏览器认证事件测试另行通过。Android 真机、当前浏览器旧标签页及真实局域网手机未直接验证，交付需提示旧网页强制刷新。

1. “测试通过”只说明测试覆盖的范围通过，不能替代真实实例验证。
2. 涉及前端或服务端的改动，完成前依次检查：生产构建、相关测试、运行中的服务版本和端口、真实数据接口、真实页面交互。
3. 涉及手机或交互的改动，同时验证桌面鼠标、触屏点击/长按/滑动、关闭、边界和失败恢复。
4. 视频组、图片组、笔记配图必须用真实已有组验证成员数量、缩略图、翻页和排序卡片数量；不能只用新建 fixture 组。
5. 只有代码、构建、运行实例、页面交互和发布状态都核对后，才可以向用户说“已完成”。
6. 本地可通过日志、数据库、请求记录和自动化浏览器复现的问题，先由开发者定位，不要求用户反复截图证明。

## 内容浏览与分组

- 2026-10-11 微信图片保真：当前真实收件原图为 1920×1080、1602×932，卡片缩略图单独为 800 像素；正文、配图窗口与缩放查看使用 `/original`，媒体接口字节与已存原文件哈希一致。普通消息已使用腾讯协议 `image_item.media`，不能把其字段名“原图”误说成微信必定下发拍摄原件；上游 issue #241 有勾选原图仍被压缩的反馈，未证实本次具体图片的发送前尺寸。新增 type 4 图片文件附件（JPG/PNG/WebP/GIF/AVIF），按 `file_item.media` 下载解密，校验可选原文件长度与 MD5；真实图片解码仍必须通过。微信单图上限统一 100 MB，普通图片和附件显式保持原文件，不继承网页采集的有损压缩设置。复用原消息顺序、稳定 ID、分篇与重试回执；不创建重复缩略图素材、不恢复已删除配图。完成记录已删除密钥，不能凭旧记录补回高清；需重新发送原始文件。
- 微信本次验收：超过 25 MB 的 PNG 通过腾讯 AES 编码附件路径后入库逐字节一致；混合图文顺序、部分失败重试、重复消息、100 MB 边界、错误长度/MD5、伪装文件、取消均验证。生产构建通过，当前 3741 实例真实三张微信图片接口和桌面/模拟触屏正文→配图→缩放/关闭、加载失败重试、帮助点击/键盘关闭已验证，证据 `artifacts/weixin-original-live-sMpbU6/result.json`（截图已遮挡图片）。全量 233 项初跑 231 项通过，两项视频备份因 Windows EPERM rename 失败，单独复测通过；后续微信备份也遇到一次同类锁，单独复测通过。真实手机通过 ClawBot 发送文件附件尚无入站记录，不得称端到端高清已验证；微信账号、设置及 PIN 均保留。

- 图片组和视频组在普通浏览、多选、移动和排序时保持成组折叠；选择组卡片代表整组，只有明确移出成员或解散组才拆组。
- 组内预览必须显示完整成员数量，缩略图可直接跳转；视频组也必须有同样的翻页、缩略图预览和拖拽/按钮排序，不能只显示第一个视频。
- 排序支持正序、倒序和按类型分区；未分类知识库也必须使用同一套高级排序。统计数字以卡片为单位，同时保留图片/视频张数等明细。
- 单图浏览不能串入图片组成员；翻图、缩放、平移和当前知识库/筛选范围必须同时保留。
- 图文笔记正文第一张图可作为封面；批量上传图片可以直接形成图片组；视频可以组成视频组。
- PSD 以保留分层的原文件入库，网页从 PSD 内置合成画面生成 WebP 预览；预览不能替代原文件。文件夹批量上传、原文件下载、迁移导出和恢复后的缩略图再生成都需覆盖。不要让浏览器直接用 `<img>` 加载 PSD。
- PSD 单文件上限 200 MB，普通图片仍是 100 MB；拖拽同时出现的 FileList 与 FileSystemEntry 是同一文件，不能在候选队列中重复添加。备份验证及解压读取也要采用 PSD 的独立上限。
- PSD 分层查看要呈现原文件的图层组、顺序和隐藏状态，按需解码单层并可导出透明 PNG；眼睛开关临时改变显示并重新合成，恢复原始显示回到内置合成图。重算可能无法精确还原剪贴蒙版、效果及部分混合模式；原合成图和原 PSD 均必须保留，不能声称支持 Photoshop 式图层编辑。

## 手机采集与浮窗

- 目标是安卓手机从浏览器、小红书、抖音、B 站等 App 直接采集，优先使用分享/剪贴板自动识别，不能把“手动切到 ZNote 粘贴”当成最终体验。
- 浮窗要轻量、可拖拽、贴边半圆收起但不消失；展开不应重新启动或长时间卡顿，不遮挡浏览。采集期间自动收起，后台保存成功或失败都要即时可见，并保留任务详情和重试。
- 浮窗展开入口要有当前页面采集、剪贴板解析、目标知识库选择和跳转 ZNote 浏览；目标知识库应记住，不应每次重新选择。
- 无障碍辅助或悬浮窗权限被系统关闭时，要能诊断、提示和引导恢复。后台服务不得依赖用户反复启动前台页面。
- 抖音/小红书实况图必须保存为视频，且一条作品的多个实况段全部入库，不能只存封面或第一段。超过 25 MB 的资源不能堵塞队列，应按设置选择压缩或原图直下，并显示可重试的失败原因。
- 小红书原图可能实际返回 HEIC；网页展示 JPEG 可能带居中水印且降到 1080 像素。只从已知的小红书 CDN 图片 token 构造 `ci.xiaohongshu.com/{token}?imageView2/format/webp` 高清无水印候选，逐张验证保存结果；不要直接把带水印的展示图当首选备用图。
- 手机端支持刷新、返回上一级、长按选择卡片、触屏拖拽/滑动；不能只做桌面套壳。

- 手机后台采集不能只依赖七天有效的网页登录 Cookie；App 成功登录时自动建立按服务器隔离的持久 API 读写授权，选库、提交、上传、结果轮询统一使用 Bearer。密码和授权不进入公开仓库，授权必须可撤销。Android 签名保存在本机 LOCALAPPDATA/ZNote/signing（DPAPI 密码），沿用原密钥和递增 versionCode。

## 浏览器扩展与采集

- 2026-10-09：E-Hentai 图集 `3454472/b2fc51c27b` 和 `4050874/4076ef32b1` 初查返回 HTTP 200 的纯文本 IP 临时封禁页（excessive request rate）；后续前者可读 147 页，后者返回 Content Warning，不能只用首次封禁概括两个链接或误报未登录。前者旧的第 4 页临时 H@H 地址实测 403，重读图片页后的新地址为 200 image/webp。入库先取目录，逐张下载前再读图片页，单张地址失败最多刷新一次；重试沿用原任务/页序，已保存成员不重读图片页或重复入库。图集默认图片组，解析供本机下载时仍返回直接图片地址，图片页并发最多 2。只跟随同源同图集的 `nw=session`，保留该请求范围的数字 `nw` Cookie 通过 302 和目录分页；不能跟随其他图集/外站或 `nw=always`，不改变浏览器永久偏好。此前“让用户点击 View Gallery 再贴相同链接”不足以恢复，因为服务器不共享浏览器 Cookie。页面和原图回退共用冷却状态，读到封禁立即停止剩余请求并保留已保存页。冷却按平台给出的时长计算，缺少时长则五分钟后允许复查；进程重启后需重新确认，不宣称全局代理或浏览器均受此状态控制。失败路径和单页验证不能说成真实整套采集已成功。

- 2026-10-09 验收补充：上述两个 EH 真实失败任务已在当前 3741 实例恢复成功。第一套沿用任务 `a7bb757a-ffe9-41f7-aab9-518d644625e6`，从 108 补至 147 张；第二套沿用 `fd114b16-e8db-4bae-a8d3-5d2a58dbb4c3`，完整 46 张。均保持单组、连续页序和出处，未新增任务或删除用户另一次未完成的重复图组。安装目录的 0.9.37 扩展弹窗文档分别用鼠标/触屏点击真实重试按钮，确认成功状态和查看入口；实际图库分别验证桌面/触屏首、中、末跳页与关闭，首/中/末媒体接口可读取并解码尺寸。截图已目视检查并遮挡作品图；证据 `artifacts/eh-complete-ebdmV1/result.json`。229 项测试与生产构建通过，运行 PID 495544，生产首页与 dist 完全一致。Android 真机及浏览器原生 action 弹窗未验证，不得说成这两项也已验收。

- 2026-10-08：kxmh8 的 `/comic数字/chapter数字.html` 阅读页从 `.single .font_max img.comic_img` 取得整章 `data-original`，保留签名参数和 DOM 阅读顺序，排除导航、广告，不跟随下一章。默认图片组，组模式最多 200 张，笔记模式仍为 100 张；缺图/重复地址明确失败。真实章节 `comic117807/chapter0.html` 有 175 页，不能用正文可读性提取或原有 100 张限制截断。已用实际网站、安装目录的 0.9.37 扩展和当前 3741 服务完整入库，验证 175 页单组、来源/备注、首/中/末原图，以及桌面/触屏跳页和关闭；证据 `artifacts/comic-live-McfbLR/result.json`。Android 真机未验证；组内跳转后预览栏会重新收起，验收需再次展开再点远页。

- 2026-10-08：推文 `2107765375521939865` 用户明确为视频，不能用另一条图组的成功当作验收。X 浏览器数据必须携带按推文编号关联的 `video.twimg.com` MP4 候选，而非只传 `video:true` 后再让服务器/yt-dlp 重抓受限链接；该真实链接在公开嵌入和 guest GraphQL 都返回 Tombstone。页面读取器按需从 React 播放数据及有界 GraphQL 响应取得候选，隔离引用帖和其他帖、优先高码率；无可用地址时明确提示播放后重试，不退化成封面或纯文字笔记。视频保存须验证实际播放和正文/来源保留，不能只看入库成功。

- 2026-10-08：X 公开嵌入接口对真实推文 `2107765375521939865` 返回 `TweetTombstone`，不能据此断言推文已删除或用户未登录。扩展优先读取当前页面里时间戳/媒体链接编号匹配的文章；只传有界正文、作者及最多四张自身 `pbs.twimg.com/media/` 图片，经服务器独立验证编号、主机与格式。单帖、通用入口、弹窗和下载复用同一读取路径，引用帖、头像与仅提到该链接的其他帖不得混入。带新页面数据的失败任务原位重试，保留分组与去重；纯链接没有页面上下文时仍受公开接口限制。公开作品和测试页面采集成功不能替代登录受限原帖的验证。

- 2026-10-08：普通网页采集扩展以 `saveAction=save|download` 保存默认方式，默认入库；页面只提供选中的操作和快捷键，选库在下载模式隐藏但保留值。图片、套图、视频、作品、正文与截图同步遵循。运行任务固定启动时的操作；下载只能产生本机文件，不能调用入库接口作兜底。`POST /api/captures/resolve` 只解析、不写条目或采集任务；整个作品下载保留所有实况段、跳过封面，单项失败继续其他资源。私有独立扩展有自己的存储，不能声称修改普通扩展设置会自动同步它们。

- 2026-10-08：HTTP(S) 顶层页面统一使用 `page-tools.js` 工具栏：当前作品、视频嗅探与更多菜单（选库、粘贴作品链接、正文、视频解析、两种截图、浏览知识库和设置）。左侧把手支持鼠标/触屏拖动与方向键，后台记住位置并在视口变化时限制边界。黑名单、ZNote 自动排除与浮窗开关必须同时作用；视频面板随工具栏位置避让。
- 采集进度显示服务器真实 `message`、耗时和配图/实况片段数量；未知总字节时不伪造下载百分比。X、小红书原有单帖按钮也复用同一反馈区。其他网页复用已有平台/正文解析，不能声称任意登录墙或动态站点都可采集。
- 框选截图使用立即启动确认，弹窗确认选择器挂载后才关闭；拖动选择和保存由页面与后台继续完成，不依赖弹窗长消息存活。截图隐藏所有工具栏/预览；验证必须点击真实 popup.js 按钮并关闭弹窗文档，不能只从测试页面直接调用后台截图函数。无头 Edge 不暴露原生 action 弹窗，此项只能验证真实弹窗文档与关闭生命周期，不能声称验证了用户正在使用的浏览器原生弹窗。

- 扩展弹窗按「采集 / 任务 / 插件」组织，目标知识库放顶部并持久保存；链接和高级解析按需展开。作品、视频、截图与本页媒体任务反馈集中显示，完成任务不能禁用下一次作品采集。
- 浏览器插件以公开 `addons/browser/catalog.json` 与本机被忽略的 `private/catalog.json` 登记，统一 `npm run addons -- list/check/build/pack`。固定公钥对应的扩展 ID 必须检查，构建保持原加载目录；安装包按需生成。导航、帮助和基础样式统一由 `common/` 维护。
- X 详情页固定显示「ZNote · 保存本帖」，时间线含图推文保留操作栏「保存图组」。入口不能只依赖 `<time>`、操作栏或页面初始 HTML；SPA 换帖更新当前作品 URL，黑名单隐藏按钮，引用图片不创建独立采集入口。
- X 页面保存、视频入口与结果提示共用一条工具栏，提示支持关闭/Esc，视频面板按工具栏实际高度避让；其他站点入口与图片预览保留。覆盖解压目录不等于后台已重新加载：新页面脚本可能遇到旧后台。提交先检查协议，空响应短暂重试，仍失败明确提示扩展重新加载并刷新网页，不得只报「提交失败」或误称平台验证失败。

- 扩展名称和 UI 风格统一；保存/下载尽量在当前页面完成，不打开干扰浏览的新页面。
- 直接视频嗅探可能只拿到 fMP4/DASH 初始化片段；嗅探阶段过滤 `init.mp4` / `seg-*-init.mp4`，下载和入库前按 `Content-Range` 补齐分段，并拒绝没有 `mdat` 媒体数据的微小 MP4，避免生成只有几百字节且无法播放的条目。
- Pixiv、Paw、套图和视频嗅探等扩展的队列失败要自动重试并在不展开队列时可见；大图悬停操作、套图识别和翻页不能要求手动刷新或遮挡页面。
- Paw 原图不只在 `file.pawchive.pw`，2026-09-30 真实 Patreon 作品的 5 张原图都在 `n2.pawchive.pw/data/`，缩略图仍在 `img.pawchive.pw/thumbnail/`。浏览器扩展和服务器按链接采集都需认可 Paw 数字文件主机并限制 `/data/` 与图片扩展名；真实页面应核对成员数与分组，不能把原图误判为未登录。
- 资源嗅探支持按网址黑名单禁用预览/下载；私有 Pixiv、E-Hentai 等插件放在独立本地目录，不在公开 ZNote 中提供下载地址或源码。
- 小红书帖子列表使用绝对定位瀑布流；扩展按钮不得覆盖卡片的 `position`，否则多列会散成斜线。涉及站点卡片注入时用真实瀑布流布局检查首行列数和卡片坐标。
- 小红书列表卡片的 `/explore/{id}` 链接可能没有 `xsec_token`；服务器独立请求会得到验证页。网页扩展的单帖按钮必须优先利用浏览器已登录页面的作品数据，并用缺少完整数据的服务器响应回归测试；不能只用服务器必然成功的图集 fixture 证明按钮可用。
- 小红书详情页可能由站点 SPA 打开，初始 HTML 脚本仍是旧列表内容；扩展需读取当前页面内存中的详情记录。列表卡片有多条作品链接时，优先选带 `xsec_token` 的链接；若仍缺完整数据，直接提示打开详情页重试，不要反过来建议用户安装已经在用的扩展。
- 小红书个人主页收藏卡片的规范作品链接是 `/explore/{id}`，但访问参数可能在同一卡片的 `/user/profile/{用户}/{id}?xsec_token=...&xsec_source=pc_user` 链接上。按相同作品编号配对后把参数附到规范链接；真实浏览器里该请求返回完整 `noteDetailMap`。
- 小红书当前 SSR 状态脚本会出现 `new Map([])`，不能直接当纯 JSON；解析时只对字符串外的这个确定字面量做安全归一化，禁止执行页面脚本。视频流除了 `h264` 也会使用 `EF4/EF5` 等键。旧失败视频任务若通过浏览器提交了新 plan，应直接入队，不能再调用会清除视频 plan 的普通 retry；2026-09-27 用真实作品 `6ab891b6000000001a02a709` 验证入库为 22.334 秒 AVC 视频。

## UI 约定

- 解释、快捷键和使用提示统一用 `src/HelpHint.jsx` 问号组件；必要状态、错误和操作结果直接显示，操作区不要堆大段小字。
- 标签点标签本身用于检索同标签资源，只有点 X 才删除；按钮分组要按操作目的组织，避免一排挤在一起。
- 网格、紧凑网格、列表、紧凑列表在桌面和手机都必须真正区分；选择工具栏要支持长按/多选，不依赖“选择整组”这种替代按钮。

## 备份、发布与私有扩展

- 恢复备份和迁移导出分开：恢复备份可保留必要副本，迁移包按需即时导出，避免长期占用空间。
- 发布前必须确认构建产物、版本号、签名/升级兼容性和 Git 远端状态；不能只看 CI 页面标题。发布后确认实际安装包版本高于已安装版本。
- AI 对话归纳笔记 skill 作为 ZNote 的可选插件维护；私有 AI 助手和私有站点插件与公开仓库分离，不把密钥写入仓库或文档。

## 品牌与宣传片

- 2026-10-07 用户选定「03 手写 Z」：字形采用流畅曲线和带弧度的收尾，深绿色底、米白色笔画。图标源以 `public/icon.svg` 为准；`scripts/build-client-icons.mjs` 统一生成网页、桌面、Android 和普通浏览器扩展图标，避免各端回退为普通字体 Z。
- 宣传片介绍与 README 同步，重点是微信记录灵感、图片与图组浏览整理、浏览器就地采集，再介绍 Android 浮窗与自己保管数据。不能在公开内容中提供私有站点扩展的源码或下载地址。
- 旁白使用自然神经语音；场景时长需覆盖实际音频并留白。配乐在旁白期间降低音量，导出后检查完整音视频、字幕和最终画面，不能只交旧版成片或只凭脚本报完成。
- 宣传片高清交付使用 `tools/promo` 的 `--1080p` 路径：浏览器按 1920 × 1080 重新绘制并录制，混音与验证也带同一参数；保留 720P 版本，高清成片独立命名，交付前核对实际分辨率。

## 最近一次教训

视频组修复曾经只通过临时 Playwright fixture，真实页面仍出现“0 个视频 / 视频组不存在”。后续必须同时使用真实运行服务、真实组数据和页面交互验证，并在报告中区分“测试通过”和“用户实例已验证”。
