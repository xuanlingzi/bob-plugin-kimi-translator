var lang = require("./lang.js");

function getHeaders()  {
    const trafficId = Array.from({ length: 20 }, () => Math.floor(Math.random() * 36).toString(36)).join('')
    return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + $option.access_token,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36 Edg/91.0.864.41',
        'Origin': 'https://kimi.moonshot.cn',
        'Referer': 'https://kimi.moonshot.cn/',
        'X-Traffic-Id': trafficId,
    }
}

function translate(query, completion) {

    if ($option.access_token.length === 0 || $option.refresh_token.length === 0) {
        query.onCompletion({
            error: {
                type: "secretKey",
                message: "未设置Token"
            }
        })
    }

    (async () => {

        let header = getHeaders();

        let chatReq = await $http.request({
            url: "https://kimi.moonshot.cn/api/chat",
            method: "POST",
            header,
            body: {
                name: 'Kimi',
                is_example: false
            }
        })

        if (chatReq.response.statusCode === 401) {
            header['Authorization'] = 'Bearer ' + $option.refresh_token
            const refreshReq = await $http.request({
                url: "https://kimi.moonshot.cn/api/auth/token/refresh",
                method: "GET",
                header
            })
            if (refreshReq.response.statusCode === 200) {
                $option.access_token = refreshReq.data.access_token
                $option.refresh_token = refreshReq.data.refresh_token

                header['Authorization'] = 'Bearer ' + $option.access_token
                chatReq = await $http.request({
                    url: "https://kimi.moonshot.cn/api/chat",
                    method: "POST",
                    header,
                    body: {
                        name: 'Kimi',
                        is_example: false
                    }
                })
            } else {
                query.onCompletion({
                    error: {
                        type: "api",
                        message: "Token刷新失败",
                        addtion:  JSON.stringify(refreshReq.response),
                    }
                })
                return
            }
        }

        const chatId = await chatReq.data.id;

        const messages = [{
            role: 'user',
            content: '你是一个精通各国语言的翻译引擎，只翻译我给的文字，不需要解释这些文字，' + '\n' + '请把以下内容从' + lang.langMap.get(query.detectFrom) + '翻译成' + lang.langMap.get(query.detectTo) + '\n' + query.text
        }]

        let targetText = '';
        let buffer = ''
        let hasError = false
        let finished = false
        await $http.streamRequest({
            url: `https://kimi.moonshot.cn/api/chat/${chatId}/completion/stream`,
            method: "POST",
            header,
            body: {
                messages,
                refs: [],
                user_search: true,
            },
            cancelSignal: query.cancelSignal,
            streamHandler: (streamData) => {

                if (finished) return

                buffer += streamData.text
                try {
                    while (true) {
                        const match = buffer.match(/data: (.*?})\n/);
                        if (match) {
                            const textFromStreamData = match[1].trim();

                            const streamResult = JSON.parse(textFromStreamData)
                            if (streamResult.event === 'cmpl') {
                                query.onStream({
                                    result: {
                                        from: query.detectFrom,
                                        to: query.detectTo,
                                        toParagraphs: [streamResult.text]
                                    }
                                })
                                targetText += streamResult.text
                            } else if (streamResult.event === 'all_done') {
                                finished = true
                                break
                            }

                            buffer = buffer.slice(match[0].length);
                        } else {
                            break
                        }
                    }
                } catch (e) {
                    hasError = true
                    finished = false
                    query.onCompletion({
                        error: {
                            type: "unknown",
                            message: "未知错误",
                            addtion: JSON.stringify(e),
                        },
                    })
                }
            },
            handler: (result) => {
                if (finished) {
                    query.onCompletion({
                        result: {
                            from: query.detectFrom,
                            to: query.detectTo,
                            toParagraphs: [targetText]
                        }
                    })
                } else if (hasError || result.response.statusCode >= 400) {
                    query.onCompletion({
                        error: {
                            type: "unknown",
                            message: "未知错误",
                            addition: JSON.stringify(result)
                        }
                    })
                }
            }
        });

    })().catch((err) => {
        completion({
            error: {
                ...err,
                type: err.type || "unknown",
                message: err.message || "未知错误"
            },
        });
    });
}

function supportLanguages() {
    return lang.supportLanguages.map(([standardLang]) => standardLang);
}

exports.supportLanguages = supportLanguages;
exports.translate = translate;
