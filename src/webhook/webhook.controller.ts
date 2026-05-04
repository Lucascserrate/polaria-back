import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';

@Controller('webhook')
export class WebhookController {
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') token: string,
    @Res() res,
  ) {
    const VERIFY_TOKEN = 'polaria123';

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  }

  @Post()
  receiveMessage(@Body() body: any, @Res() res) {
    console.log(JSON.stringify(body, null, 2));

    return res.sendStatus(200);
  }
}
