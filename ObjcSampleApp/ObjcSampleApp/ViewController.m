#import "ViewController.h"

@interface ViewController ()

@end

@implementation ViewController

- (void)viewDidLoad
{
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor systemBlueColor];
    NSInteger v = [self _value];
    NSLog(@"%@", @(v));
}

- (NSInteger)_value
{
    return 20;
}

@end
