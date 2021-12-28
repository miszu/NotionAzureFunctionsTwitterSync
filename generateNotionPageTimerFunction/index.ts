import { AzureFunction, Context, HttpRequest } from "@azure/functions"
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { Client } from '@notionhq/client';
import { AppendBlockChildrenParameters, CreatePageParameters } from "@notionhq/client/build/src/api-endpoints";
import TwitterApi from 'twitter-api-v2';
const QuickChart = require('quickchart-js');

type RecentTweetsResponse = {
    periods: Period[];
    totalCount: number;
    numberOfDays: number;
    daysWithoutTweets: number;
}

type Period = {
    periodLabel: string;
    count: number;
}

const notionPageTitle = "Twitter activity"

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {
    const notionClient = new Client({ auth: process.env["NOTION_API_TOKEN"] });

    const preparedPageId = await prepareNotionPage(notionClient, context)

    const recentTweets = await getRecentTweets()
    context.log(`Downloaded info about ${recentTweets.totalCount} tweets from last ${recentTweets.numberOfDays} days`)

    const chartBlobUrl = await createChartForTwitterActivity(recentTweets);
    context.log(`Generated chart and uploaded it to the Blob Storage - ${chartBlobUrl}`)

    await populateNotionPageWithTwitterActivity(notionClient, preparedPageId, recentTweets, chartBlobUrl)
    context.log(`Done`)
};

const prepareNotionPage = async function (notionClient: Client, context: Context): Promise<string> {
    const searchResult = await notionClient.search({
        query: notionPageTitle,
        filter:
        {
            property: 'object', value: 'page'
        }
    })

    const existingPage = searchResult.results[0]

    if (existingPage) {
        const blocksToRemove = await notionClient.blocks.children.list({ block_id: existingPage.id, page_size: 100 })
        context.log(`Page '${notionPageTitle}' exists already (${existingPage.id}), removing ${blocksToRemove.results.length} blocks...`)
        for (const block of blocksToRemove.results.reverse()) {
            await notionClient.blocks.delete({ block_id: block.id })
        }

        return existingPage.id
    }

    context.log(`Page '${notionPageTitle}' does not exist yet, creating it...`)
    const page: CreatePageParameters = {
        parent: { page_id: process.env["NOTION_PAGE_ID"] },
        icon:
        {
            emoji: '🧵'
        },
        cover:
        {
            external:
            {
                // Photo by Todd Diemer on Unsplash
                url: 'https://unsplash.com/photos/ImgYcloGOCU/download?ixid=MnwxMjA3fDB8MXxzZWFyY2h8MTU3fHxyZWxheHxlbnwwfHx8fDE2NDA0MDUyNTQ&force=true&w=2400'
            }
        },
        properties: {
            title: {
                title: [{
                    text: {
                        content: notionPageTitle
                    }
                }],
            },
        },
    }
    const pageCreationResponse = await notionClient.pages.create(page)
    return pageCreationResponse.id
}

const populateNotionPageWithTwitterActivity = async function (notionClient: Client, preparedNotionPageId: string, recentTweets: RecentTweetsResponse, chartBlobUrl: string): Promise<void> {
    const blocksToAppend: AppendBlockChildrenParameters = {
        block_id: preparedNotionPageId,
        children: [
            {
                heading_3: {
                    text: [{
                        text: {
                            content: `Your activity over the last ${recentTweets.numberOfDays} days`
                        }
                    }]
                }
            },
            {
                bulleted_list_item: {
                    text: [{
                        text: {
                            content: `Total tweets: ${recentTweets.totalCount} 👁`
                        }
                    }]
                }
            },
            {
                bulleted_list_item: {
                    text: [{
                        text: {
                            content: `Tweets per day: ${(recentTweets.totalCount / recentTweets.numberOfDays).toFixed(1)} 🎯`
                        }
                    }]
                }
            },
            {
                bulleted_list_item: {
                    text: [{
                        text: {
                            content: `Days without tweets: ${recentTweets.daysWithoutTweets} ${recentTweets.daysWithoutTweets == 0 ? '🚀' : '👀'}`
                        }
                    }]
                }
            },
            {
                bulleted_list_item: {
                    text: [{
                        text: {
                            content: `Updated at: ${new Date().toLocaleString()} 📆`
                        }
                    }]
                }
            },
            {
                image: {
                    external: {
                        url: chartBlobUrl
                    }
                }
            }
        ]
    }

    await notionClient.blocks.children.append(blocksToAppend)
}

const getRecentTweets = async function (): Promise<RecentTweetsResponse> {
    const twitterClient = new TwitterApi(process.env["TWITTER_USER_TOKEN"]).readOnly
    const tweetCountResponse = await twitterClient.v2.tweetCountRecent(`from:${process.env["TWITTER_USER_NAME"]}`, { granularity: 'day' })
    const startOfFirstPeriod = tweetCountResponse.data.map(x => new Date(x.start)).sort(x => x.getTime())[0]

    return {
        totalCount: tweetCountResponse.meta.total_tweet_count,
        numberOfDays: Math.round((new Date().getTime() - startOfFirstPeriod.getTime()) / (1000 * 60 * 60 * 24)),
        daysWithoutTweets: tweetCountResponse.data.filter(x => x.tweet_count == 0).length,
        periods: tweetCountResponse.data.map(p => ({ count: p.tweet_count, periodLabel: `${new Date(p.start).getDate()}.${new Date(p.start).getMonth() + 1}` }))
    }
}

const createChartForTwitterActivity = async function (recentTweets: RecentTweetsResponse): Promise<string> {

    const account = process.env["STORAGE_ACCOUNT_NAME"]

    const sharedKeyCredential = new StorageSharedKeyCredential(account, process.env["STORAGE_ACCOUNT_KEY"]);
    const blobServiceClient = new BlobServiceClient(
        `https://${account}.blob.core.windows.net`,
        sharedKeyCredential
    );

    const blobContainer = 'charts'
    var containerClient = blobServiceClient.getContainerClient(blobContainer);

    if (!await containerClient.exists()) {
        containerClient.create({ access: 'blob' })
    }

    const imageName = `chart_${new Date().getTime()}.png`
    const newBlob = containerClient.getBlockBlobClient(imageName)

    const tweetsChart = new QuickChart()
        .setWidth(1000)
        .setHeight(300)
        .setConfig({
            type: 'bar',
            data: {
                labels: recentTweets.periods.map(x => x.periodLabel),
                datasets: [{
                    data: recentTweets.periods.map(x => x.count),
                    backgroundColor: QuickChart.pattern.draw('diagonal-right-left', 'darkgreen'),
                }]
            },
            options: {
                yAxes: [{
                    ticks: {
                        min: 0,
                        max: recentTweets.periods.map(x => x.count).sort().pop() + 2,
                        stepSize: 2
                    }
                }],
                scales: {
                    yAxes: [{
                        gridLines: {
                            display: false
                        }
                    }]
                },
                plugins: {
                    roundedBars: true
                },
                legend: {
                    display: false
                }
            }
        });

    const chartAsBinary = await tweetsChart.toBinary()
    const blobOptions = { blobHTTPHeaders: { blobContentType: 'image/png' } };

    await newBlob.upload(chartAsBinary, chartAsBinary.length, blobOptions)

    return `${containerClient.url}/${newBlob.name}`;
}

export default timerTrigger;