import {expect, it} from 'bun:test'
import {WebScrapeTool} from '@/Tools/WebScrapeTool';

const scrapper = new WebScrapeTool()


it('should return a valid html', async () => {
  const html = await scrapper.use({
      url: 'https://antropic.com',
      selector: 'title',
      parseDom: true,
  })
  expect(html).toBeDefined()
})