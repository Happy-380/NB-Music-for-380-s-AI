const axios = require("axios");
const md5 = require("md5");
const { lyric_new, search } = require("NeteaseCloudMusicApi");

class MusicSearcher {
    /**
     * 音乐搜索组件
     */
    constructor() {
        this.COOKIE = "";
        this.settingManager = null; // 将由外部设置
        // 添加歌词缓存对象
        this.lyricsCache = {
            netease: {},
            bilibili: {}
        };
    }

    // 新增：设置依赖
    setDependencies(settingManager) {
        this.settingManager = settingManager;
    }

    async searchBilibiliVideo(keyword, page = 1, order = "totalrank", duration = 0, tids = 0) {
        const mixinKeyEncTab = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

        function getMixinKey(orig) {
            return mixinKeyEncTab
                .map((n) => orig[n])
                .join("")
                .slice(0, 32);
        }

        function encWbi(params, imgKey, subKey) {
            const mixinKey = getMixinKey(imgKey + subKey);
            const currTime = Math.round(Date.now() / 1000);
            const chrFilter = /[!'()*]/g;

            params.wts = currTime;

            const query = Object.keys(params)
                .sort()
                .map((key) => {
                    const value = params[key].toString().replace(chrFilter, "");
                    return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
                })
                .join("&");

            const wbiSign = md5(query + mixinKey);
            return `${query}&w_rid=${wbiSign}`;
        }

        async function getWbiKeys() {
            const response = await axios.get("https://api.bilibili.com/x/web-interface/nav");
            const {
                wbi_img: { img_url, sub_url }
            } = response.data.data;

            return {
                img_key: img_url.slice(img_url.lastIndexOf("/") + 1, img_url.lastIndexOf(".")),
                sub_key: sub_url.slice(sub_url.lastIndexOf("/") + 1, sub_url.lastIndexOf("."))
            };
        }

        try {
            // 获取 wbi keys 等辅助处理…
            const { img_key, sub_key } = await getWbiKeys();
            const params = {
                search_type: "video",
                keyword,
                order,
                duration,
                tids,
                page // 使用传入的页码
            };
            const query = encWbi(params, img_key, sub_key);
            const response = await axios.get(`https://api.bilibili.com/x/web-interface/wbi/search/type?${query}`);
            if (response.data.code !== 0) {
                throw new Error(response.data.message || "搜索失败");
            }
            return response.data.data.result || [];
        } catch (error) {
            console.error("搜索B站视频失败:", error);
            throw error;
        }
    }

    async searchMusic(keyword, page = 1) {
        if (!keyword) return;

        try {
            // 检查是否是视频链接
            if (this.isBilibiliLink(keyword)) {
                this.handleBilibiliLink(keyword);
                return;
            }

            // 显示搜索结果区域
            this.uiManager.show(".search-result");
            const list = document.querySelector(".search-result .list");

            // 显示骨架屏加载效果 - 替换旧的加载动画
            const skeletonItems = Array(6)
                .fill("")
                .map(
                    () => `
                <div class="skeleton-item">
                    <div class="skeleton-poster shine"></div>
                    <div class="skeleton-info">
                        <div class="skeleton-title shine"></div>
                        <div class="skeleton-artist shine"></div>
                    </div>
                    <div class="skeleton-actions shine"></div>
                </div>
            `
                )
                .join("");

            list.innerHTML = `
                <div class="skeleton-container">
                    ${skeletonItems}
                    <style>
                        .skeleton-container {
                            width: 100%;
                            display: flex;
                            flex-direction: column;
                            gap: 16px;
                            padding: 8px;
                        }
                        .skeleton-item {
                            display: flex;
                            align-items: center;
                            gap: 16px;
                            padding: 12px;
                            border-radius: 8px;
                            background: rgba(255, 255, 255, 0.05);
                            height: 72px;
                        }
                        .skeleton-poster {
                            width: 48px;
                            height: 48px;
                            border-radius: 8px;
                            background: rgba(255, 255, 255, 0.08);
                            flex-shrink: 0;
                        }
                        .skeleton-info {
                            flex: 1;
                            display: flex;
                            flex-direction: column;
                            gap: 8px;
                        }
                        .skeleton-title {
                            width: 70%;
                            height: 16px;
                            border-radius: 4px;
                            background: rgba(255, 255, 255, 0.08);
                        }
                        .skeleton-artist {
                            width: 40%;
                            height: 12px;
                            border-radius: 4px;
                            background: rgba(255, 255, 255, 0.08);
                        }
                        .skeleton-actions {
                            width: 32px;
                            height: 32px;
                            border-radius: 50%;
                            background: rgba(255, 255, 255, 0.08);
                        }
                        .shine {
                            background: linear-gradient(90deg, 
                                rgba(255, 255, 255, 0.05) 25%, 
                                rgba(255, 255, 255, 0.15) 50%, 
                                rgba(255, 255, 255, 0.05) 75%);
                            background-size: 200% 100%;
                            animation: shine 1.5s infinite linear;
                        }
                        @keyframes shine {
                            0% { background-position: -200% 0; }
                            100% { background-position: 200% 0; }
                        }
                        :root.light .skeleton-item {
                            background: rgba(0, 0, 0, 0.05);
                        }
                        :root.light .skeleton-poster,
                        :root.light .skeleton-title,
                        :root.light .skeleton-artist,
                        :root.light .skeleton-actions {
                            background: rgba(0, 0, 0, 0.08);
                        }
                        :root.light .shine {
                            background: linear-gradient(90deg, 
                                rgba(0, 0, 0, 0.05) 25%, 
                                rgba(0, 0, 0, 0.15) 50%, 
                                rgba(0, 0, 0, 0.05) 75%);
                            background-size: 200% 100%;
                        }
                    </style>
                </div>
            `;

            // 搜索处理
            const searchResults = await this.searchBilibiliVideo(keyword, page);
            list.innerHTML = "";

            if (!searchResults.length) {
                list.innerHTML = "未找到相关内容";
                return;
            }

            // 渲染搜索结果
            searchResults.forEach((song) => {
                // 确保获取作者信息
                const authorName = song.author || "未知艺术家";

                const div = this.uiManager.createSongElement(
                    {
                        title: song.title.replace(/<em class="keyword">|<\/em>/g, ""),
                        artist: authorName,
                        poster: "https:" + song.pic
                    },
                    song.bvid,
                    { isDelete: false, isLove: false }
                );

                // 点击事件处理
                div.addEventListener("click", async () => {
                    try {
                        const cleanTitle = song.title.replace(/<em class="keyword">|<\/em>/g, "");
                        if (this.playlistManager.playlist.find((item) => item.title === cleanTitle)) {
                            document.querySelector("#function-list .player").click();
                            return;
                        }

                        // 先切换到播放器界面
                        document.querySelector("#function-list .player").click();

                        // 预先设置基本信息，确保包含作者信息
                        const songInfo = {
                            title: cleanTitle,
                            artist: authorName,
                            poster: "https:" + song.pic,
                            bvid: song.bvid,
                            lyric: "等待获取歌词"
                        };
                        await this.playlistManager.updateUIForCurrentSong(songInfo);

                        // 设置加载状态
                        const playButton = document.querySelector(".control>.buttons>.play");
                        const progressBar = document.querySelector(".progress-bar-inner");
                        playButton.disabled = true;
                        progressBar.classList.add("loading");

                        // 获取音频URL等信息
                        const urls = await this.getAudioLink(song.bvid, true);
                        let url = urls[0];
                        try {
                            const res = await axios.get(url);
                            if (res.status === 403) {
                                url = urls[1];
                            }
                        } catch {
                            url = urls[1];
                        }

                        // 完成加载，创建完整的歌曲对象
                        const videoUrl = await this.getBilibiliVideoUrl(song.bvid, urls[2]);
                        const newSong = {
                            ...songInfo,
                            audio: url,
                            cid: urls[2],
                            video: videoUrl,
                            lyric: await (this.settingManager.getSetting("lyricSearchType") === "custom" ? this.showLyricSearchDialog(cleanTitle) : this.getLyrics(keyword, song.bvid, urls[2])) // 修改为传递bvid和cid
                        };

                        // 恢复界面状态
                        progressBar.classList.remove("loading");
                        playButton.disabled = false;

                        // 添加到播放列表并播放
                        this.playlistManager.addSong(newSong);
                        this.playlistManager.setPlayingNow(this.playlistManager.playlist.length - 1);
                        this.uiManager.renderPlaylist();
                    } catch (error) {
                        console.error("添加歌曲失败:", error);
                    }
                });
                list.appendChild(div);
            });

            // 创建分页控制
            const paginationContainer = document.createElement("div");
            paginationContainer.className = "pagination";

            // 上一页按钮
            if (page > 1) {
                const prevBtn = document.createElement("button");
                prevBtn.className = "pagination-btn";
                prevBtn.innerHTML = '<i class="bi bi-chevron-left"></i> 上一页';
                prevBtn.onclick = () => this.searchMusic(keyword, page - 1);
                paginationContainer.appendChild(prevBtn);
            }

            // 页码显示
            const pageInfo = document.createElement("span");
            pageInfo.className = "page-info";
            pageInfo.textContent = `第 ${page} 页`;
            paginationContainer.appendChild(pageInfo);

            // 下一页按钮
            const nextBtn = document.createElement("button");
            nextBtn.className = "pagination-btn";
            nextBtn.innerHTML = '下一页 <i class="bi bi-chevron-right"></i>';
            nextBtn.onclick = () => this.searchMusic(keyword, page + 1);
            paginationContainer.appendChild(nextBtn);

            // 添加分页控制到搜索结果区域
            list.appendChild(paginationContainer);
        } catch (error) {
            console.error("搜索失败:", error);
            // eslint-disable-next-line no-undef
            list.innerHTML = "搜索失败，请重试";
        }
    }

    /**
     * 检查是否为哔哩哔哩视频链接
     * @param {string} text - 待检查的文本
     * @returns {boolean} 是否为哔哩哔哩视频链接
     */
    isBilibiliLink(text) {
        // 匹配各种B站视频链接格式
        const patterns = [
            /https?:\/\/(?:www\.)?bilibili\.com\/video\/([A-Za-z0-9]+)/i, // 标准网页链接
            /https?:\/\/b23\.tv\/([A-Za-z0-9]+)/i, // 短链接
            /BV([A-Za-z0-9]+)/i, // BV号直接输入
            /av(\d+)/i // av号直接输入
        ];

        return patterns.some((pattern) => pattern.test(text));
    }

    /**
     * 从文本中提取视频ID
     * @param {string} text - 包含视频链接的文本
     * @returns {string|null} 视频ID，未找到则返回null
     */
    extractVideoId(text) {
        // 从各种格式中提取BV号或AV号
        const bvMatch = text.match(/BV([A-Za-z0-9]+)/i) || text.match(/\/video\/BV([A-Za-z0-9]+)/i);
        if (bvMatch) {
            return `BV${bvMatch[1]}`;
        }

        const avMatch = text.match(/av(\d+)/i) || text.match(/\/video\/av(\d+)/i);
        if (avMatch) {
            return `av${avMatch[1]}`;
        }

        // 处理短链接，需要进行重定向获取最终URL
        const shortMatch = text.match(/b23\.tv\/([A-Za-z0-9]+)/i);
        if (shortMatch) {
            return `https://b23.tv/${shortMatch[1]}`; // 返回完整短链接，后续需要解析
        }

        return null;
    }

    /**
     * 处理哔哩哔哩视频链接
     * @param {string} link - 视频链接
     */
    async handleBilibiliLink(link) {
        try {
            this.uiManager.showNotification("正在解析视频链接...", "info");

            // 提取视频ID
            let videoId = this.extractVideoId(link);

            if (!videoId) {
                throw new Error("无法识别视频ID");
            }

            // 处理短链接的情况
            if (videoId.startsWith("https://")) {
                try {
                    // 显示加载状态
                    this.uiManager.showNotification("正在解析短链接...", "info");

                    // 获取短链接的最终URL
                    const response = await fetch(videoId, {
                        method: "HEAD",
                        redirect: "follow"
                    });

                    // 从重定向后的URL中提取视频ID
                    const finalUrl = response.url;
                    videoId = this.extractVideoId(finalUrl);

                    if (!videoId) {
                        throw new Error("无法从短链接解析视频ID");
                    }
                } catch (error) {
                    console.error("短链接解析失败:", error);
                    throw new Error("短链接解析失败");
                }
            }

            // 获取视频信息
            this.uiManager.showNotification("正在获取视频信息...", "info");

            // 判断是BV号还是AV号
            const isBvid = videoId.startsWith("BV");

            // 获取视频详情
            let videoDetail;
            try {
                const params = isBvid ? `bvid=${videoId}` : `aid=${videoId.substring(2)}`;
                const response = await axios.get(`https://api.bilibili.com/x/web-interface/view?${params}`);

                if (response.data.code !== 0) {
                    throw new Error(response.data.message || "获取视频信息失败");
                }

                videoDetail = response.data.data;
            } catch (error) {
                console.error("获取视频信息失败:", error);
                throw new Error("获取视频信息失败，请检查链接是否正确");
            }

            // 切换到播放器界面
            document.querySelector("#function-list .player").click();

            // 预先设置基本信息
            const songInfo = {
                title: videoDetail.title,
                artist: videoDetail.owner.name,
                poster: videoDetail.pic.startsWith("http") ? videoDetail.pic : `https:${videoDetail.pic}`,
                bvid: isBvid ? videoId : videoDetail.bvid,
                lyric: "等待获取歌词"
            };

            await this.playlistManager.updateUIForCurrentSong(songInfo);

            // 设置加载状态
            const playButton = document.querySelector(".control>.buttons>.play");
            const progressBar = document.querySelector(".progress-bar-inner");
            playButton.disabled = true;
            progressBar.classList.add("loading");

            // 获取音频URL等信息
            const urls = await this.getAudioLink(isBvid ? videoId : videoDetail.bvid, true);
            let url = urls[0];

            try {
                const res = await axios.get(url);
                if (res.status === 403) {
                    url = urls[1];
                }
            } catch {
                url = urls[1];
            }

            // 获取视频URL
            const videoUrl = await this.getBilibiliVideoUrl(isBvid ? videoId : videoDetail.bvid, urls[2]);

            // 获取歌词
            const lyricSearchType = this.settingManager.getSetting("lyricSearchType");
            let lyric;

            if (lyricSearchType === "custom") {
                lyric = await this.showLyricSearchDialog(videoDetail.title);
            } else {
                lyric = await this.getLyrics(videoDetail.title, isBvid ? videoId : videoDetail.bvid, urls[2]);
            }

            // 完成加载，创建完整的歌曲对象
            const newSong = {
                ...songInfo,
                audio: url,
                cid: urls[2],
                video: videoUrl,
                lyric: lyric
            };

            // 恢复界面状态
            progressBar.classList.remove("loading");
            playButton.disabled = false;

            // 添加到播放列表并播放
            this.playlistManager.addSong(newSong);
            this.playlistManager.setPlayingNow(this.playlistManager.playlist.length - 1);
            this.uiManager.renderPlaylist();

            this.uiManager.showNotification(`成功播放视频: ${videoDetail.title}`, "success");
        } catch (error) {
            console.error("处理B站链接失败:", error);
            this.uiManager.showNotification(`无法播放视频: ${error.message}`, "error");
        }
    }

    async getAudioLink(videoId, isBvid = true) {
        // 获取CID直接调用API
        async function getCid(videoId, isBvid = true) {
            const params = isBvid ? `bvid=${videoId}` : `aid=${videoId}`;
            const response = await axios.get(`https://api.bilibili.com/x/web-interface/view?${params}`);

            const data = await response.data;
            if (data.code !== 0) {
                throw new Error(data.message || "获取视频信息失败");
            }
            return data.data.cid;
        }
        const cid = await getCid(videoId, isBvid);
        const params = isBvid ? `bvid=${videoId}&cid=${cid}&fnval=16&fnver=0&fourk=1` : `avid=${videoId}&cid=${cid}&fnval=16&fnver=0&fourk=1`;

        const response = await axios.get(`https://api.bilibili.com/x/player/playurl?${params}`);

        const data = await response.data;
        if (data.code !== 0) {
            throw new Error(data.message || "获取音频链接失败");
        }

        const audioStream = data.data.dash.audio;
        if (!audioStream || audioStream.length === 0) {
            throw new Error("未找到音频流");
        }

        const bestAudio = audioStream[0];
        console.log(bestAudio);
        return [bestAudio.baseUrl, bestAudio.backupUrl, cid];
    }

    async getLyrics(songName, bvid = null, cid = null, forceSource = null) {
        try {
            // 确定使用的歌词来源
            const lyricSource = forceSource || this.settingManager.getSetting("lyricSource") || "netease";

            // 优先从缓存获取
            if (lyricSource === "bilibili" && bvid && cid && this.lyricsCache.bilibili[`${bvid}-${cid}`]) {
                return this.lyricsCache.bilibili[`${bvid}-${cid}`];
            } else if (lyricSource === "netease" && songName && this.lyricsCache.netease[songName]) {
                return this.lyricsCache.netease[songName];
            }

            // 智能获取歌词模式
            if (lyricSource === "smart" && songName && bvid && cid) {
                try {
                    // 显示加载状态
                    this.showLoadingState(true);
                    
                    // 尝试从网易云获取歌词
                    let neteaseLyrics = "暂无歌词，尽情欣赏音乐";
                    let bilibiliLyrics = "暂无歌词，尽情欣赏音乐";
                    let neteaseSuccess = false;
                    
                    try {
                        const searchResponse = await search({
                            keywords: songName,
                            limit: 1
                        });
                        
                        const searchResult = searchResponse.body;
                        if (searchResult.result && searchResult.result.songs && searchResult.result.songs.length > 0) {
                            const songId = searchResult.result.songs[0].id;
                            const yrcResponse = await lyric_new({ id: songId });
                            
                            if (yrcResponse.body) {
                                const yrcLyrics = yrcResponse.body;
                                neteaseLyrics = yrcLyrics.yrc ? yrcLyrics.yrc.lyric : 
                                               yrcLyrics.lrc ? yrcLyrics.lrc.lyric : 
                                               "暂无歌词，尽情欣赏音乐";
                                               
                                if (neteaseLyrics && neteaseLyrics !== "暂无歌词，尽情欣赏音乐") {
                                    neteaseSuccess = true;
                                    // 缓存网易云歌词
                                    this.lyricsCache.netease[songName] = neteaseLyrics;
                                }
                            }
                        }
                    } catch (error) {
                        console.error("智能获取模式: 获取网易云歌词失败", error);
                    }
                    
                    // 尝试从B站获取字幕
                    let bilibiliSuccess = false;
                    try {
                        bilibiliLyrics = await this.getBilibiliSubtitle(bvid, cid);
                        
                        if (bilibiliLyrics && bilibiliLyrics !== "暂无歌词，尽情欣赏音乐") {
                            bilibiliSuccess = true;
                            // 缓存B站字幕
                            this.lyricsCache.bilibili[`${bvid}-${cid}`] = bilibiliLyrics;
                        }
                    } catch (error) {
                        console.error("智能获取模式: 获取B站字幕失败", error);
                    }
                    
                    // 隐藏加载状态
                    this.showLoadingState(false);
                    
                    // 决定使用哪个来源的歌词
                    if (neteaseSuccess) {
                        console.log("智能获取模式: 使用网易云歌词");
                        return neteaseLyrics;
                    } else if (bilibiliSuccess) {
                        console.log("智能获取模式: 使用B站字幕");
                        return bilibiliLyrics;
                    } else {
                        console.log("智能获取模式: 无可用歌词");
                        return "暂无歌词，尽情欣赏音乐";
                    }
                } catch (error) {
                    console.error("智能获取歌词失败", error);
                    this.showLoadingState(false);
                    return "暂无歌词，尽情欣赏音乐";
                }
            }
            
            // 原有的获取逻辑
            if (lyricSource === "bilibili" && bvid && cid) {
                try {
                    // 显示加载状态
                    this.showLoadingState(true);

                    const lyrics = await this.getBilibiliSubtitle(bvid, cid);

                    // 缓存结果
                    if (lyrics && lyrics !== "暂无歌词，尽情欣赏音乐") {
                        this.lyricsCache.bilibili[`${bvid}-${cid}`] = lyrics;
                    }

                    // 隐藏加载状态
                    this.showLoadingState(false);

                    return lyrics;
                } catch (error) {
                    console.error("获取B站字幕失败，尝试网易云歌词", error);
                    // B站字幕获取失败，尝试网易云歌词
                    if (songName) {
                        return this.getLyrics(songName, bvid, cid, "netease");
                    }
                    // 隐藏加载状态
                    this.showLoadingState(false);
                    return "暂无歌词，尽情欣赏音乐";
                }
            } else if (songName) {
                try {
                    // 显示加载状态
                    this.showLoadingState(true);

                    const searchResponse = await search({
                        keywords: songName,
                        limit: 1
                    });
                    const searchResult = searchResponse.body;
                    if (!searchResult.result || !searchResult.result.songs || searchResult.result.songs.length === 0) {
                        // 网易云搜索失败，如果有B站视频ID，尝试B站字幕
                        if (bvid && cid && lyricSource !== "netease") {
                            return this.getLyrics(songName, bvid, cid, "bilibili");
                        }
                        // 隐藏加载状态
                        this.showLoadingState(false);
                        return "暂无歌词，尽情欣赏音乐";
                    }

                    const songId = searchResult.result.songs[0].id;
                    const yrcResponse = await lyric_new({ id: songId });

                    if (!yrcResponse.body) {
                        // 隐藏加载状态
                        this.showLoadingState(false);
                        return "暂无歌词，尽情欣赏音乐";
                    }

                    const yrcLyrics = yrcResponse.body;
                    const lyrics = yrcLyrics.yrc ? yrcLyrics.yrc.lyric : yrcLyrics.lrc ? yrcLyrics.lrc.lyric : "暂无歌词，尽情欣赏音乐";

                    // 缓存结果
                    if (lyrics && lyrics !== "暂无歌词，尽情欣赏音乐") {
                        this.lyricsCache.netease[songName] = lyrics;
                    }

                    // 隐藏加载状态
                    this.showLoadingState(false);

                    return lyrics;
                } catch (error) {
                    console.error("获取网易云歌词失败", error);
                    // 网易云歌词获取失败，如果有B站视频ID，尝试B站字幕
                    if (bvid && cid && lyricSource !== "netease") {
                        return this.getLyrics(songName, bvid, cid, "bilibili");
                    }
                    // 隐藏加载状态
                    this.showLoadingState(false);
                    return "暂无歌词，尽情欣赏音乐";
                }
            }

            // 隐藏加载状态
            this.showLoadingState(false);
            return "暂无歌词，尽情欣赏音乐";
        } catch (error) {
            console.error("获取歌词失败", error);
            // 隐藏加载状态
            this.showLoadingState(false);
            return "暂无歌词，尽情欣赏音乐";
        }
    }

    // 新增：获取B站字幕
    async getBilibiliSubtitle(bvid, cid) {
        try {
            // 参数验证
            if (!bvid || !cid) {
                console.warn("获取B站字幕失败：缺少必要参数bvid或cid");
                return "暂无歌词，尽情欣赏音乐";
            }
            
            // 构建API请求
            const url = `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${cid}`;

            // 发送请求
            const response = await axios.get(url);

            // 检查请求是否成功
            if (response.data.code !== 0) {
                throw new Error(`获取B站字幕失败：${response.data.message}`);
            }

            // 提取字幕信息
            const { subtitle } = response.data.data;

            // 如果没有字幕
            if (!subtitle || !subtitle.list || subtitle.list.length === 0) {
                console.log(`视频 ${bvid} 没有可用字幕`);
                return "暂无歌词，尽情欣赏音乐";
            }

            // 获取字幕列表中的第一个字幕
            const firstSubtitle = subtitle.list[0];

            // 获取字幕文件的URL
            const subtitleUrl = firstSubtitle.subtitle_url;
            
            if (!subtitleUrl) {
                console.warn(`视频 ${bvid} 字幕URL为空`);
                return "暂无歌词，尽情欣赏音乐";
            }

            // 如果URL以http://开头，需要转换为https://
            const secureUrl = subtitleUrl.startsWith("http://") ? subtitleUrl.replace("http://", "https://") : subtitleUrl;

            // 获取字幕文件内容
            const subtitleResponse = await axios.get(secureUrl);
            
            if (!subtitleResponse.data) {
                console.warn(`视频 ${bvid} 字幕内容为空`);
                return "暂无歌词，尽情欣赏音乐";
            }

            // 将字幕格式转换为歌词格式
            const lyrics = this.convertSubtitleToLyrics(subtitleResponse.data);
            console.log(`成功获取视频 ${bvid} 的字幕`);
            return lyrics;
        } catch (error) {
            console.error("获取B站字幕失败：", error);
            throw error;
        }
    }

    // 新增：将B站字幕格式转换为歌词格式
    convertSubtitleToLyrics(subtitleData) {
        // B站字幕通常是JSON格式，包含body字段，每个元素有from(开始时间)、to(结束时间)和content(内容)
        if (!subtitleData || !subtitleData.body || !Array.isArray(subtitleData.body) || subtitleData.body.length === 0) {
            return "暂无歌词，尽情欣赏音乐";
        }

        // 排序字幕，确保按时间顺序
        const sortedSubtitles = subtitleData.body.sort((a, b) => a.from - b.from);

        // 转换为LRC格式
        return sortedSubtitles
            .map((item) => {
                // 转换秒为分:秒.毫秒格式
                const minutes = Math.floor(item.from / 60);
                const seconds = Math.floor(item.from % 60);
                const milliseconds = Math.floor((item.from % 1) * 100);

                // 格式化时间标签：[mm:ss.xx]
                const timeTag = `[${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(2, "0")}]`;

                // 返回带时间标签的歌词行
                return `${timeTag}${item.content}`;
            })
            .join("\n");
    }

    // 新增：显示/隐藏加载状态
    showLoadingState(isLoading) {
        // 在实际项目中，这个方法会被替换为真实实现
        // 这里只是一个占位符
        if (window.app && window.app.uiManager) {
            const progressBar = document.querySelector(".progress-bar-inner");
            if (progressBar) {
                if (isLoading) {
                    progressBar.classList.add("loading");
                } else {
                    progressBar.classList.remove("loading");
                }
            }
        }
    }

    async getBilibiliVideoUrl(bvid, cid) {
        try {
            // 如果cid不存在，尝试获取
            if (!cid) {
                try {
                    const cidResponse = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
                    if (cidResponse.data.code === 0) {
                        cid = cidResponse.data.data.cid;
                    }

                    if (!cid) {
                        throw new Error("无法获取视频CID");
                    }
                } catch (error) {
                    console.error("获取CID失败:", error);
                    throw new Error("获取视频信息失败");
                }
            }

            // 获取用户设置的视频清晰度，默认为720P
            let quality = 64; // 默认720P

            if (this.settingManager) {
                quality = this.settingManager.getSetting("videoQuality") || 64;
            }

            // 根据清晰度判断是否启用4K和其他高级功能
            const fourk = quality >= 120 ? 1 : 0;

            // 设置fnval，根据需要的功能组合不同的值
            let fnval = 16; // 基本DASH格式
            if (quality === 125) {
                fnval |= 64; // 需要HDR视频
            } else if (quality === 126) {
                fnval |= 512; // 需要杜比视界
            } else if (quality === 127) {
                fnval |= 1024; // 需要8K分辨率
            }

            const response = await fetch(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=${quality}&fnval=${fnval}&fnver=0&fourk=${fourk}`, {
                // 继续使用现有的请求配置
            });

            if (!response.ok) {
                throw new Error("获取视频URL失败");
            }

            const data = await response.json();

            if (data.code !== 0) {
                throw new Error(data.message);
            }

            // 解析并选择最佳视频流
            const dashData = data.data.dash;
            if (dashData && dashData.video && dashData.video.length > 0) {
                // 根据清晰度选择最佳视频流
                return this.selectBestVideoStream(dashData.video, quality);
            } else {
                // 如果没有DASH格式，尝试使用durl（旧格式）
                if (data.data.durl && data.data.durl.length > 0) {
                    return data.data.durl[0].url;
                }
                throw new Error("无可用视频流");
            }
        } catch (error) {
            console.error("获取B站视频URL失败:", error);
            return null;
        }
    }

    // 新增：选择最佳视频流
    selectBestVideoStream(videoStreams, preferredQuality) {
        // 首先按质量(id)降序排序
        videoStreams.sort((a, b) => b.id - a.id);

        // 找出不超过用户设置清晰度的最高质量流
        for (let stream of videoStreams) {
            // 如果流的质量小于等于用户首选质量，选择它
            if (stream.id <= preferredQuality) {
                return stream.baseUrl || stream.base_url;
            }
        }

        // 如果没找到合适的，返回可用的最高质量
        return videoStreams[0].baseUrl || videoStreams[0].base_url;
    }

    async showLyricSearchDialog(songTitle) {
        return new Promise((resolve) => {
            const dialog = document.getElementById("lyricSearchDialog");
            const titleDiv = document.getElementById("currentSongTitle");
            const keywordInput = document.getElementById("lyricKeyword");
            const skipBtn = document.getElementById("skipLyric");
            const confirmBtn = document.getElementById("confirmLyric");

            // 显示当前歌曲信息
            titleDiv.textContent = songTitle;
            keywordInput.value = songTitle;
            dialog.classList.remove("hide");

            const handleSkip = () => {
                cleanup();
                resolve("暂无歌词，尽情欣赏音乐");
            };

            const handleConfirm = async () => {
                const keyword = keywordInput.value.trim();
                cleanup();
                if (keyword) {
                    try {
                        const lyric = await this.getLyrics(keyword);
                        resolve(lyric);
                    } catch {
                        resolve("暂无歌词，尽情欣赏音乐");
                    }
                } else {
                    resolve("暂无歌词，尽情欣赏音乐");
                }
            };

            const handleKeydown = (e) => {
                if (e.key === "Enter") {
                    handleConfirm();
                } else if (e.key === "Escape") {
                    handleSkip();
                }
            };

            const cleanup = () => {
                dialog.classList.add("hide");
                skipBtn.removeEventListener("click", handleSkip);
                confirmBtn.removeEventListener("click", handleConfirm);
                keywordInput.removeEventListener("keydown", handleKeydown);
            };

            skipBtn.addEventListener("click", handleSkip);
            confirmBtn.addEventListener("click", handleConfirm);
            keywordInput.addEventListener("keydown", handleKeydown);

            // 聚焦输入框
            keywordInput.focus();
            keywordInput.select();
        });
    }

    async getSearchSuggestions(term) {
        if (!term) return [];

        try {
            const params = {
                term,
                main_ver: "v1",
                func: "suggest",
                suggest_type: "accurate",
                sub_type: "tag",
                tag_num: 10,
                rnd: Math.random()
            };

            const response = await axios.get("https://s.search.bilibili.com/main/suggest", { params });

            if (response.data?.code === 0 && response.data?.result?.tag) {
                return response.data.result.tag;
            }
            return [];
        } catch (error) {
            console.error("获取搜索建议失败:", error);
            return [];
        }
    }
}

module.exports = MusicSearcher;
